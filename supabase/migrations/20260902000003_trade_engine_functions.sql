-- 1. FUNCTION: Place and Lock Order Margin
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
    -- Intraday (MIS) uses 5x leverage -> 20% margin required (0.20)
    -- Delivery (CNC) requires 100% upfront cash (1.00)
    IF p_product_type = 'MIS' THEN
        v_multiplier := 0.20;
    ELSE
        v_multiplier := 1.00;
    END IF;

    -- Determine price baseline to calculate required margin
    IF p_order_type = 'LIMIT' THEN
        v_required_margin := p_limit_price * p_quantity * v_multiplier;
    ELSE
        v_required_margin := p_estimated_price * p_quantity * v_multiplier;
    END IF;

    -- Lock and check wallet balance atomically
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

    -- Deduct from cash balance and move to locked margin
    UPDATE public.wallets
    SET cash_balance = cash_balance - v_required_margin,
        locked_margin = locked_margin + v_required_margin,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Insert order record
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
        CASE WHEN p_order_type = 'MARKET' THEN 'FILLED' ELSE 'PENDING' END,
        p_virtual_time
    )
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. FUNCTION: Fill Order Atomically & Update Portfolio Position
CREATE OR REPLACE FUNCTION public.execute_order_fill(
    p_order_id UUID,
    p_fill_price NUMERIC(14, 2),
    p_fill_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_order RECORD;
    v_margin_used NUMERIC(14, 2);
    v_multiplier NUMERIC(4, 2);
BEGIN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.status = 'FILLED' THEN
        RETURN; -- Already processed
    END IF;

    v_multiplier := CASE WHEN v_order.product_type = 'MIS' THEN 0.20 ELSE 1.00 END;
    v_margin_used := p_fill_price * v_order.quantity * v_multiplier;

    -- Mark order filled
    UPDATE public.orders
    SET status = 'FILLED',
        filled_price = p_fill_price,
        filled_quantity = v_order.quantity,
        filled_at = p_fill_time,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Update or create position
    INSERT INTO public.positions (user_id, symbol, product_type, quantity, average_buy_price)
    VALUES (v_order.user_id, v_order.symbol, v_order.product_type, v_order.quantity, p_fill_price)
    ON CONFLICT (user_id, symbol, product_type)
    DO UPDATE SET
        average_buy_price = ((positions.quantity * positions.average_buy_price) + (v_order.quantity * p_fill_price)) / (positions.quantity + v_order.quantity),
        quantity = positions.quantity + v_order.quantity,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;