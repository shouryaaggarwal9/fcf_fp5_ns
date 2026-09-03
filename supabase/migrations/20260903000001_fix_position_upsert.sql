-- 1. Ensure explicit composite primary/unique constraint exists
ALTER TABLE public.positions 
DROP CONSTRAINT IF EXISTS positions_user_id_symbol_product_type_key;

ALTER TABLE public.positions 
ADD CONSTRAINT positions_user_id_symbol_product_type_key 
UNIQUE (user_id, symbol, product_type);

-- 2. Clean, robust execute_order_fill with explicit lock & upsert
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
    v_margin_to_release NUMERIC(14, 2) := 0.00;
    v_new_qty INTEGER;
    v_multiplier NUMERIC(4, 2);
    v_order_margin NUMERIC(14, 2);
    v_actual_margin NUMERIC(14, 2);
    v_margin_diff NUMERIC(14, 2);
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

    -- ==================== BUY SIDE ====================
    IF v_order.side = 'BUY' THEN
        -- Adjust any limit price margin variance
        v_order_margin := COALESCE(v_order.limit_price, p_fill_price) * v_order.quantity * v_multiplier;
        v_actual_margin := p_fill_price * v_order.quantity * v_multiplier;
        v_margin_diff := v_order_margin - v_actual_margin;

        IF v_margin_diff <> 0 THEN
            UPDATE public.wallets
            SET cash_balance = cash_balance + v_margin_diff,
                locked_margin = locked_margin - v_margin_diff,
                updated_at = NOW()
            WHERE user_id = v_order.user_id;
        END IF;

        -- Check if position already exists
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

    -- ==================== SELL SIDE ====================
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

        v_pnl := (p_fill_price - v_pos.average_buy_price) * v_order.quantity;
        v_margin_to_release := v_pos.average_buy_price * v_order.quantity * v_multiplier;

        -- Release locked margin and credit/debit PnL
        UPDATE public.wallets
        SET locked_margin = GREATEST(0.00, locked_margin - v_margin_to_release),
            cash_balance = cash_balance + v_margin_to_release + v_pnl,
            updated_at = NOW()
        WHERE user_id = v_order.user_id;

        v_new_qty := v_pos.quantity - v_order.quantity;

        UPDATE public.positions
        SET quantity = v_new_qty,
            average_sell_price = CASE 
                WHEN v_pos.average_sell_price = 0.00 THEN p_fill_price 
                ELSE ((v_pos.average_sell_price + p_fill_price) / 2.0) 
            END,
            realized_pnl = v_pos.realized_pnl + v_pnl,
            updated_at = NOW()
        WHERE id = v_pos.id;

        -- Clean up orphaned fractional margins if all positions are closed
        IF v_new_qty = 0 THEN
            UPDATE public.wallets
            SET locked_margin = 0.00
            WHERE user_id = v_order.user_id 
              AND NOT EXISTS (
                  SELECT 1 FROM public.positions WHERE user_id = v_order.user_id AND quantity > 0
              ) 
              AND NOT EXISTS (
                  SELECT 1 FROM public.orders WHERE user_id = v_order.user_id AND status = 'PENDING'
              );
        END IF;
    END IF;

    -- Mark Order as FILLED
    UPDATE public.orders
    SET status = 'FILLED',
        filled_price = p_fill_price,
        filled_quantity = v_order.quantity,
        filled_at = p_fill_time,
        updated_at = NOW()
    WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;