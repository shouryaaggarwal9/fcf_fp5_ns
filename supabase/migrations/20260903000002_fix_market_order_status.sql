CREATE OR REPLACE FUNCTION public.place_order_with_margin(
    p_user_id UUID,
    p_symbol VARCHAR(20),
    p_side order_side,
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
    v_required_margin NUMERIC(14, 2) := 0.00;
    v_current_cash NUMERIC(14, 2);
    v_multiplier NUMERIC(4, 2);
    v_exec_price NUMERIC(14, 2);
    v_pos RECORD;
BEGIN
    v_multiplier := CASE WHEN p_product_type = 'MIS' THEN 0.20 ELSE 1.00 END;
    v_exec_price := COALESCE(p_limit_price, p_estimated_price);

    IF p_side = 'BUY' THEN
        v_required_margin := v_exec_price * p_quantity * v_multiplier;

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

        UPDATE public.wallets
        SET cash_balance = cash_balance - v_required_margin,
            locked_margin = locked_margin + v_required_margin,
            updated_at = NOW()
        WHERE user_id = p_user_id;

    ELSIF p_side = 'SELL' THEN
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = p_product_type
        FOR UPDATE;

        IF NOT FOUND OR v_pos.quantity < p_quantity THEN
            RAISE EXCEPTION 'Cannot SELL: Open position of % qty is less than order qty %', 
                COALESCE(v_pos.quantity, 0), p_quantity;
        END IF;
    END IF;

    -- ALL orders enter as PENDING so execute_order_fill can process the transition
    INSERT INTO public.orders (
        user_id,
        symbol,
        side,
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
        p_side,
        p_order_type,
        p_product_type,
        p_quantity,
        p_limit_price,
        p_trigger_price,
        p_stop_loss_price,
        'PENDING'::order_status,
        p_virtual_time
    )
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;