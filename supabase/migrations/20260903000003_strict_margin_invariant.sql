-- Helper to compute user's exact required locked margin across all open positions and pending orders
CREATE OR REPLACE FUNCTION public.recalculate_user_margin(p_user_id UUID)
RETURNS NUMERIC(14, 2) AS $$
DECLARE
    v_pending_margin NUMERIC(14, 2) := 0.00;
    v_position_margin NUMERIC(14, 2) := 0.00;
    v_total NUMERIC(14, 2);
BEGIN
    -- Sum pending buy order margins
    SELECT COALESCE(SUM(
        COALESCE(limit_price, 0) * quantity * (CASE WHEN product_type = 'MIS' THEN 0.20 ELSE 1.00 END)
    ), 0.00)
    INTO v_pending_margin
    FROM public.orders
    WHERE user_id = p_user_id 
      AND status IN ('PENDING', 'TRIGGER_PENDING')
      AND side = 'BUY';

    -- Sum open position margins
    SELECT COALESCE(SUM(
        average_buy_price * quantity * (CASE WHEN product_type = 'MIS' THEN 0.20 ELSE 1.00 END)
    ), 0.00)
    INTO v_position_margin
    FROM public.positions
    WHERE user_id = p_user_id 
      AND quantity > 0;

    v_total := v_pending_margin + v_position_margin;

    UPDATE public.wallets
    SET locked_margin = v_total,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Clean execute_order_fill using the invariant
CREATE OR REPLACE FUNCTION public.execute_order_fill(
    p_order_id UUID,
    p_fill_price NUMERIC(14, 2),
    p_fill_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_order RECORD;
    v_pos RECORD;
    v_pnl NUMERIC(14, 2) := 0.00;
    v_multiplier NUMERIC(4, 2);
    v_order_cost NUMERIC(14, 2);
BEGIN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.status = 'FILLED' THEN
        RETURN;
    END IF;

    v_multiplier := CASE WHEN v_order.product_type = 'MIS' THEN 0.20 ELSE 1.00 END;

    -- ==================== BUY FILL ====================
    IF v_order.side = 'BUY' THEN
        -- Check if position exists
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = v_order.user_id 
          AND symbol = v_order.symbol 
          AND product_type = v_order.product_type
        FOR UPDATE;

        IF FOUND THEN
            UPDATE public.positions
            SET average_buy_price = ((v_pos.quantity * v_pos.average_buy_price) + (v_order.quantity * p_fill_price)) / (v_pos.quantity + v_order.quantity),
                quantity = v_pos.quantity + v_order.quantity,
                updated_at = NOW()
            WHERE id = v_pos.id;
        ELSE
            INSERT INTO public.positions (
                user_id,
                symbol,
                product_type,
                quantity,
                average_buy_price,
                average_sell_price,
                realized_pnl
            )
            VALUES (
                v_order.user_id,
                v_order.symbol,
                v_order.product_type,
                v_order.quantity,
                p_fill_price,
                0.00,
                0.00
            );
        END IF;

    -- ==================== SELL FILL ====================
    ELSIF v_order.side = 'SELL' THEN
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = v_order.user_id 
          AND symbol = v_order.symbol 
          AND product_type = v_order.product_type
        FOR UPDATE;

        IF NOT FOUND OR v_pos.quantity < v_order.quantity THEN
            RAISE EXCEPTION 'Cannot settle SELL: Available position qty % is less than order qty %', 
                COALESCE(v_pos.quantity, 0), v_order.quantity;
        END IF;

        -- Realized P&L
        v_pnl := (p_fill_price - v_pos.average_buy_price) * v_order.quantity;
        -- Release cash: Returned position margin (avg_buy * qty * mult) + PnL
        v_order_cost := (v_pos.average_buy_price * v_order.quantity * v_multiplier) + v_pnl;

        UPDATE public.wallets
        SET cash_balance = cash_balance + v_order_cost,
            updated_at = NOW()
        WHERE user_id = v_order.user_id;

        UPDATE public.positions
        SET quantity = v_pos.quantity - v_order.quantity,
            average_sell_price = CASE 
                WHEN v_pos.average_sell_price = 0.00 THEN p_fill_price 
                ELSE ((v_pos.average_sell_price + p_fill_price) / 2.0) 
            END,
            realized_pnl = v_pos.realized_pnl + v_pnl,
            updated_at = NOW()
        WHERE id = v_pos.id;
    END IF;

    -- Mark Order as FILLED
    UPDATE public.orders
    SET status = 'FILLED',
        filled_price = p_fill_price,
        filled_quantity = v_order.quantity,
        filled_at = p_fill_time,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Strictly recalculate user margin across remaining state
    PERFORM public.recalculate_user_margin(v_order.user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Update square_off_position to delegate to execute_order_fill
CREATE OR REPLACE FUNCTION public.square_off_position(
    p_user_id UUID,
    p_symbol VARCHAR(20),
    p_product_type product_type,
    p_exit_price NUMERIC(14, 2),
    p_exit_time TIMESTAMPTZ
)
RETURNS UUID AS $$
DECLARE
    v_pos RECORD;
    v_order_id UUID;
BEGIN
    SELECT * INTO v_pos
    FROM public.positions
    WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = p_product_type AND quantity > 0
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No open position found for % % to square off', p_symbol, p_product_type;
    END IF;

    -- Insert SELL MARKET Order
    INSERT INTO public.orders (
        user_id,
        symbol,
        side,
        order_type,
        product_type,
        quantity,
        limit_price,
        status,
        placed_at_virtual_time
    )
    VALUES (
        p_user_id,
        p_symbol,
        'SELL'::order_side,
        'MARKET'::order_type,
        p_product_type,
        v_pos.quantity,
        p_exit_price,
        'PENDING'::order_status,
        p_exit_time
    )
    RETURNING id INTO v_order_id;

    -- Fill immediately
    PERFORM public.execute_order_fill(v_order_id, p_exit_price, p_exit_time);

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;