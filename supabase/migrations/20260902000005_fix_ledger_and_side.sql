-- 1. Ensure orders table has a side column (BUY / SELL)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_side') THEN
        CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
    END IF;
END$$;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS side order_side NOT NULL DEFAULT 'BUY';

ALTER TABLE public.positions
ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0.00;

-- 2. Update execute_order_fill: Release initial locked margin on fill for MIS
CREATE OR REPLACE FUNCTION public.execute_order_fill(
    p_order_id UUID,
    p_fill_price NUMERIC(14, 2),
    p_fill_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_order RECORD;
    v_locked_margin NUMERIC(14, 2);
    v_actual_margin NUMERIC(14, 2);
    v_diff NUMERIC(14, 2);
BEGIN
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND OR v_order.status = 'FILLED' THEN
        RETURN;
    END IF;

    -- If actual fill price differed from estimated price at order placement,
    -- adjust the difference back to cash balance so locked_margin is exact.
    IF v_order.product_type = 'MIS' THEN
        v_actual_margin := p_fill_price * v_order.quantity * 0.20;
        -- Recalculate what was locked at limit_price or placed_price
        v_locked_margin := COALESCE(v_order.limit_price, p_fill_price) * v_order.quantity * 0.20;
        v_diff := v_locked_margin - v_actual_margin;

        IF v_diff <> 0 THEN
            UPDATE public.wallets
            SET cash_balance = cash_balance + v_diff,
                locked_margin = locked_margin - v_diff,
                updated_at = NOW()
            WHERE user_id = v_order.user_id;
        END IF;
    END IF;

    -- Mark order filled
    UPDATE public.orders
    SET status = 'FILLED',
        filled_price = p_fill_price,
        filled_quantity = v_order.quantity,
        filled_at = p_fill_time,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- Update or create position
    INSERT INTO public.positions (user_id, symbol, product_type, quantity, average_buy_price, realized_pnl)
    VALUES (v_order.user_id, v_order.symbol, v_order.product_type, v_order.quantity, p_fill_price, 0.00)
    ON CONFLICT (user_id, symbol, product_type)
    DO UPDATE SET
        average_buy_price = ((positions.quantity * positions.average_buy_price) + (v_order.quantity * p_fill_price)) / (positions.quantity + v_order.quantity),
        quantity = positions.quantity + v_order.quantity,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update Square Off: Release full locked margin cleanly & track Realized P&L
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
    SELECT * INTO v_pos
    FROM public.positions
    WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = 'MIS' AND quantity > 0
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Realized P&L: (Exit Price - Entry Price) * Quantity
    v_pnl := (p_exit_price - v_pos.average_buy_price) * v_pos.quantity;
    v_margin_to_release := v_pos.average_buy_price * v_pos.quantity * 0.20;

    -- Return locked margin, credit/debit P&L directly into Cash Balance
    UPDATE public.wallets
    SET locked_margin = GREATEST(0.00, locked_margin - v_margin_to_release),
        cash_balance = cash_balance + v_margin_to_release + v_pnl,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Update position to 0 quantity and accumulate realized P&L
    UPDATE public.positions
    SET quantity = 0,
        realized_pnl = realized_pnl + v_pnl,
        updated_at = NOW()
    WHERE id = v_pos.id;

    -- Record explicit SELL order
    INSERT INTO public.orders (
        user_id,
        symbol,
        side,
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
        'SELL'::order_side,
        'MARKET'::order_type,
        'MIS'::product_type,
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