-- Enhance execute_order_fill to automatically create exit orders for BUY fills
CREATE OR REPLACE FUNCTION public.execute_order_fill(
    p_order_id UUID, p_fill_price NUMERIC(14, 2), p_fill_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_uid UUID; v_sym VARCHAR(20); v_ptype product_type; v_side order_side; v_qty INTEGER;
    v_stat order_status; v_lmt NUMERIC(14, 2); v_target NUMERIC(14, 2); v_sl NUMERIC(14, 2);
    v_pos RECORD; v_mult NUMERIC(4, 2); v_margin_diff NUMERIC(14, 2);
BEGIN
    SELECT user_id, symbol, product_type, side, quantity, status, limit_price, target_price, stop_loss_price
    INTO v_uid, v_sym, v_ptype, v_side, v_qty, v_stat, v_lmt, v_target, v_sl
    FROM public.orders WHERE id = p_order_id;

    IF v_stat IS NULL OR v_stat IN ('FILLED', 'CANCELLED', 'REJECTED') THEN
        RETURN;
    END IF;
    v_mult := CASE WHEN v_ptype = 'MIS' THEN 0.20 ELSE 1.00 END;

    PERFORM 1 FROM public.wallets WHERE user_id = v_uid FOR UPDATE;

    IF v_side = 'BUY' THEN
        v_margin_diff := (COALESCE(v_lmt, p_fill_price) * v_qty * v_mult)
            - (p_fill_price * v_qty * v_mult);
        IF v_margin_diff <> 0 THEN
            UPDATE public.wallets
            SET cash_balance = cash_balance + v_margin_diff,
                locked_margin = locked_margin - v_margin_diff
            WHERE user_id = v_uid;
        END IF;

        INSERT INTO public.positions (user_id, symbol, product_type, quantity, average_buy_price)
        VALUES (v_uid, v_sym, v_ptype, v_qty, p_fill_price)
        ON CONFLICT (user_id, symbol, product_type) DO UPDATE SET
            average_buy_price = ((positions.quantity * positions.average_buy_price)
                + (EXCLUDED.quantity * p_fill_price))
                / (positions.quantity + EXCLUDED.quantity),
            quantity = positions.quantity + EXCLUDED.quantity,
            updated_at = NOW();

        -- Auto-create TARGET exit order if specified
        IF v_target IS NOT NULL THEN
            INSERT INTO public.orders (
                user_id, symbol, product_type, side, order_type, quantity,
                limit_price, status, created_at, updated_at, target_price, placed_at_virtual_time
            ) VALUES (
                v_uid, v_sym, v_ptype, 'SELL', 'LIMIT'::order_type, v_qty,
                v_target, 'PENDING', NOW(), NOW(), v_target, p_fill_time
            );
        END IF;

        -- Auto-create STOP-LOSS exit order if specified
        IF v_sl IS NOT NULL THEN
            INSERT INTO public.orders (
                user_id, symbol, product_type, side, order_type, quantity,
                limit_price, trigger_price, status, created_at, updated_at, stop_loss_price, placed_at_virtual_time
            ) VALUES (
                v_uid, v_sym, v_ptype, 'SELL', 'STOP_LIMIT'::order_type, v_qty,
                v_sl, v_sl, 'TRIGGER_PENDING', NOW(), NOW(), v_sl, p_fill_time
            );
        END IF;
    ELSE
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = v_uid AND symbol = v_sym AND product_type = v_ptype
        FOR UPDATE;

        IF v_pos IS NULL OR v_pos.quantity < v_qty THEN
            RAISE EXCEPTION 'Sell exceeds current holding for %', v_sym;
        END IF;

        UPDATE public.wallets
        SET cash_balance = cash_balance
            + (v_pos.average_buy_price * v_qty * v_mult)
            + ((p_fill_price - v_pos.average_buy_price) * v_qty)
        WHERE user_id = v_uid;

        UPDATE public.positions SET
            quantity = v_pos.quantity - v_qty,
            average_sell_price = CASE
                WHEN v_pos.average_sell_price = 0 THEN p_fill_price
                ELSE (v_pos.average_sell_price + p_fill_price) / 2.0
            END,
            realized_pnl = v_pos.realized_pnl
                + ((p_fill_price - v_pos.average_buy_price) * v_qty),
            updated_at = NOW()
        WHERE id = v_pos.id;

        -- One position cannot safely have competing exit orders. Once any SELL
        -- fills, invalidate every other pending exit for this instrument.
        UPDATE public.orders SET
            status = 'CANCELLED', updated_at = NOW()
        WHERE user_id = v_uid
          AND symbol = v_sym
          AND product_type = v_ptype
          AND side = 'SELL'
          AND status IN ('PENDING', 'TRIGGER_PENDING')
          AND id <> p_order_id;
    END IF;

    UPDATE public.orders SET
        status = 'FILLED', filled_price = p_fill_price,
        filled_quantity = v_qty, filled_at = p_fill_time, updated_at = NOW()
    WHERE id = p_order_id;

    PERFORM public.recalculate_user_margin(v_uid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
