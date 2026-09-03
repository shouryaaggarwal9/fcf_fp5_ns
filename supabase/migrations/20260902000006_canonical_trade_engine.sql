-- 1. Ensure schema definitions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_side') THEN
        CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
    END IF;
END$$;

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS side order_side NOT NULL DEFAULT 'BUY';

ALTER TABLE public.positions
ADD COLUMN IF NOT EXISTS average_sell_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0.00;

-- 2. Core Order Placement & Margin Lock
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
        -- Margin required to open or add to long position
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

        -- Lock margin
        UPDATE public.wallets
        SET cash_balance = cash_balance - v_required_margin,
            locked_margin = locked_margin + v_required_margin,
            updated_at = NOW()
        WHERE user_id = p_user_id;

    ELSIF p_side = 'SELL' THEN
        -- Exit square-off check: User must own the position (Buy-Only model)
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = p_product_type
        FOR UPDATE;

        IF NOT FOUND OR v_pos.quantity < p_quantity THEN
            RAISE EXCEPTION 'Cannot SELL: Open position of % qty is less than order qty %', 
                COALESCE(v_pos.quantity, 0), p_quantity;
        END IF;
    END IF;

    -- Record Order
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
        (CASE WHEN p_order_type = 'MARKET' THEN 'FILLED' ELSE 'PENDING' END)::order_status,
        p_virtual_time
    )
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Deterministic Fill & Ledger Settlement
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

    IF NOT FOUND OR v_order.status = 'FILLED' THEN
        RETURN;
    END IF;

    v_multiplier := CASE WHEN v_order.product_type = 'MIS' THEN 0.20 ELSE 1.00 END;

    IF v_order.side = 'BUY' THEN
        -- Adjust margin drift if limit fill price differs from placed price
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

        -- Upsert Position
        INSERT INTO public.positions (user_id, symbol, product_type, quantity, average_buy_price, average_sell_price, realized_pnl)
        VALUES (v_order.user_id, v_order.symbol, v_order.product_type, v_order.quantity, p_fill_price, 0.00, 0.00)
        ON CONFLICT (user_id, symbol, product_type)
        DO UPDATE SET
            average_buy_price = ((positions.quantity * positions.average_buy_price) + (v_order.quantity * p_fill_price)) / (positions.quantity + v_order.quantity),
            quantity = positions.quantity + v_order.quantity,
            updated_at = NOW();

    ELSIF v_order.side = 'SELL' THEN
        SELECT * INTO v_pos
        FROM public.positions
        WHERE user_id = v_order.user_id AND symbol = v_order.symbol AND product_type = v_order.product_type
        FOR UPDATE;

        IF NOT FOUND OR v_pos.quantity < v_order.quantity THEN
            RAISE EXCEPTION 'Corrupt ledger: Insufficient position quantity to settle SELL fill';
        END IF;

        -- PnL Calculation: (Fill Price - Buy Average) * Exited Quantity
        v_pnl := (p_fill_price - v_pos.average_buy_price) * v_order.quantity;
        -- Release exact pro-rata locked margin
        v_margin_to_release := v_pos.average_buy_price * v_order.quantity * v_multiplier;

        -- Update Wallet: Release locked margin, credit cash with released margin + PnL
        UPDATE public.wallets
        SET locked_margin = GREATEST(0.00, locked_margin - v_margin_to_release),
            cash_balance = cash_balance + v_margin_to_release + v_pnl,
            updated_at = NOW()
        WHERE user_id = v_order.user_id;

        v_new_qty := v_pos.quantity - v_order.quantity;

        -- Update Position record
        UPDATE public.positions
        SET quantity = v_new_qty,
            average_sell_price = CASE 
                WHEN v_pos.average_sell_price = 0.00 THEN p_fill_price 
                ELSE ((v_pos.average_sell_price + p_fill_price) / 2.0) 
            END,
            realized_pnl = realized_pnl + v_pnl,
            updated_at = NOW()
        WHERE id = v_pos.id;

        -- Clean up orphaned fractional margins if quantity completely closed
        IF v_new_qty = 0 THEN
            UPDATE public.wallets
            SET locked_margin = 0.00
            WHERE user_id = v_order.user_id AND NOT EXISTS (
                SELECT 1 FROM public.positions WHERE user_id = v_order.user_id AND quantity > 0
            ) AND NOT EXISTS (
                SELECT 1 FROM public.orders WHERE user_id = v_order.user_id AND status = 'PENDING'
            );
        END IF;
    END IF;

    -- Mark Order Filled
    UPDATE public.orders
    SET status = 'FILLED',
        filled_price = p_fill_price,
        filled_quantity = v_order.quantity,
        filled_at = p_fill_time,
        updated_at = NOW()
    WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. Square-Off Procedure (Used by both Manual UI Exit and 15:15 Day-End Auto Square-Off)
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

    -- Place SELL MARKET Order
    v_order_id := public.place_order_with_margin(
        p_user_id,
        p_symbol,
        'SELL'::order_side,
        'MARKET'::order_type,
        p_product_type,
        v_pos.quantity,
        p_exit_price,
        NULL,
        NULL,
        p_exit_time,
        p_exit_price
    );

    -- Execute immediately at exit price
    PERFORM public.execute_order_fill(v_order_id, p_exit_price, p_exit_time);

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;