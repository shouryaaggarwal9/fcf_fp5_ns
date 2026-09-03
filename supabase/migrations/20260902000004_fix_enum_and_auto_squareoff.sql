-- 1. FIX: Explicitly cast the status string literal to order_status enum
CREATE OR REPLACE FUNCTION public.place_order_with_margin(
    p_user_id UUID,
    p_symbol VARCHAR(20),
    p_order_type order_type,
    p_product_type product_type,
    p_quantity INTEGER,
    p_limit_price NUMERIC(14, 2),
    p_trigger_price NUMERIC(14, 2),
    p_stop_loss_price NUMERIC(14, 2),
    p_virtual_time TIMESTAMPTZ,
    p_estimated_price NUMERIC(14, 2)
)
RETURNS UUID AS $$
DECLARE
    v_order_id UUID;
    v_required_margin NUMERIC(14, 2);
    v_current_cash NUMERIC(14, 2);
    v_multiplier NUMERIC(4, 2) := 1.00;
BEGIN
    -- MIS (Intraday) uses 5x leverage -> 20% margin (0.20)
    -- CNC (Delivery) requires 100% upfront (1.00)
    IF p_product_type = 'MIS' THEN
        v_multiplier := 0.20;
    ELSE
        v_multiplier := 1.00;
    END IF;

    IF p_order_type = 'LIMIT' THEN
        v_required_margin := p_limit_price * p_quantity * v_multiplier;
    ELSE
        v_required_margin := p_estimated_price * p_quantity * v_multiplier;
    END IF;

    SELECT cash_balance INTO v_current_cash
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_current_cash IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
    END IF;

    IF v_current_cash < v_required_margin THEN
        RAISE EXCEPTION 'Insufficient funds: Required %, Available %', v_required_margin, v_current_cash;
    END IF;

    -- Lock margin from cash balance
    UPDATE public.wallets
    SET cash_balance = cash_balance - v_required_margin,
        locked_margin = locked_margin + v_required_margin,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Insert order with EXPLICIT ENUM CAST
    INSERT INTO public.orders (
        user_id,
        symbol,
        order_type,
        product_type,
        quantity,
        limit_price,
        trigger_price,
        stop_loss_price,
        status,
        placed_at_virtual_time
    )
    VALUES (
        p_user_id,
        p_symbol,
        p_order_type,
        p_product_type,
        p_quantity,
        p_limit_price,
        p_trigger_price,
        p_stop_loss_price,
        (CASE WHEN p_order_type = 'MARKET' THEN 'FILLED' ELSE 'PENDING' END)::order_status,
        p_virtual_time
    )
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. PROCEDURE: Auto Square-off MIS Positions (15:15 IST or Margin Deficit)
CREATE OR REPLACE FUNCTION public.square_off_mis_positions(
    p_user_id UUID,
    p_symbol VARCHAR(20),
    p_exit_price NUMERIC(14, 2),
    p_exit_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_pos RECORD;
    v_pnl NUMERIC(14, 2);
    v_margin_to_release NUMERIC(14, 2);
BEGIN
    -- Find open MIS position
    SELECT * INTO v_pos
    FROM public.positions
    WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = 'MIS' AND quantity > 0
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Calculate P&L: (Exit Price - Entry Price) * Quantity
    v_pnl := (p_exit_price - v_pos.average_buy_price) * v_pos.quantity;
    -- Margin originally locked was 20% of Entry Price * Quantity
    v_margin_to_release := v_pos.average_buy_price * v_pos.quantity * 0.20;

    -- Release locked margin and credit/debit P&L to cash balance
    UPDATE public.wallets
    SET locked_margin = GREATEST(0.00, locked_margin - v_margin_to_release),
        cash_balance = GREATEST(0.00, cash_balance + v_margin_to_release + v_pnl),
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Zero out the position
    UPDATE public.positions
    SET quantity = 0,
        updated_at = NOW()
    WHERE id = v_pos.id;

    -- Log synthetic exit order for audit trail
    INSERT INTO public.orders (
        user_id,
        symbol,
        order_type,
        product_type,
        quantity,
        limit_price,
        status,
        filled_price,
        filled_quantity,
        filled_at,
        placed_at_virtual_time
    )
    VALUES (
        p_user_id,
        p_symbol,
        'MARKET',
        'MIS',
        v_pos.quantity,
        p_exit_price,
        'FILLED'::order_status,
        p_exit_price,
        v_pos.quantity,
        p_exit_time,
        p_exit_time
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;