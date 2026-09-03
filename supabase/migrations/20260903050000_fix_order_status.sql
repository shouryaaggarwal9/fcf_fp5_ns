-- Fix order status initialization in place_order_with_margin
CREATE OR REPLACE FUNCTION public.place_order_with_margin(
    p_user_id UUID, p_symbol VARCHAR(20), p_side order_side, p_order_type order_type,
    p_product_type product_type, p_quantity INTEGER, p_limit_price NUMERIC(14, 2),
    p_trigger_price NUMERIC(14, 2), p_stop_loss_price NUMERIC(14, 2),
    p_target_price NUMERIC(14, 2), p_virtual_time TIMESTAMPTZ,
    p_estimated_price NUMERIC(14, 2)
)
RETURNS UUID AS $$
DECLARE
    v_order_id UUID;
    v_req_margin NUMERIC(14, 2) := 0.00;
    v_current_cash NUMERIC(14, 2);
    v_exec_price NUMERIC(14, 2) := COALESCE(p_limit_price, p_estimated_price);
    v_mult NUMERIC(4, 2) := CASE WHEN p_product_type = 'MIS' THEN 0.20 ELSE 1.00 END;
BEGIN
    SELECT cash_balance INTO v_current_cash
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF p_side = 'BUY' THEN
        v_req_margin := v_exec_price * p_quantity * v_mult;
        IF v_current_cash < v_req_margin THEN
            RAISE EXCEPTION 'Insufficient funds: Required %, Available %', v_req_margin, v_current_cash;
        END IF;
        UPDATE public.wallets
        SET cash_balance = cash_balance - v_req_margin,
            locked_margin = locked_margin + v_req_margin
        WHERE user_id = p_user_id;
    ELSE
        PERFORM 1
        FROM public.positions
        WHERE user_id = p_user_id
          AND symbol = p_symbol
          AND product_type = p_product_type
          AND quantity >= p_quantity
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Short selling prevented: Insufficient holding for %', p_symbol;
        END IF;
    END IF;

    INSERT INTO public.orders (
        user_id, symbol, side, order_type, product_type, quantity,
        limit_price, trigger_price, stop_loss_price, target_price,
        placed_at_virtual_time, status
    ) VALUES (
        p_user_id, p_symbol, p_side, p_order_type, p_product_type, p_quantity,
        p_limit_price, p_trigger_price, p_stop_loss_price, p_target_price,
        p_virtual_time,
        CASE WHEN p_order_type = 'STOP_LIMIT' THEN 'TRIGGER_PENDING'::order_status ELSE 'PENDING'::order_status END
    ) RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
