-- =======================================================================================
-- 1. ENUMS & EXTENSIONS
-- =======================================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


DO $$ BEGIN
    CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
    CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP_LIMIT');
    CREATE TYPE product_type AS ENUM ('MIS', 'CNC');
    CREATE TYPE order_status AS ENUM ('PENDING', 'TRIGGER_PENDING', 'FILLED', 'CANCELLED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =======================================================================================
-- 2. TABLES WITH HARD CONSTRAINTS
-- =======================================================================================

-- WALLETS
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 1000000.00 CHECK (cash_balance >= 0),
    locked_margin NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (locked_margin >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- POSITIONS
CREATE TABLE IF NOT EXISTS public.positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    product_type product_type NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    average_buy_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    average_sell_price NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    realized_pnl NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT positions_user_id_symbol_product_type_key UNIQUE (user_id, symbol, product_type)
);

-- ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    side order_side NOT NULL,
    order_type order_type NOT NULL,
    product_type product_type NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    limit_price NUMERIC(14, 2),
    trigger_price NUMERIC(14, 2),
    stop_loss_price NUMERIC(14, 2),
    status order_status NOT NULL DEFAULT 'PENDING',
    filled_price NUMERIC(14, 2),
    filled_quantity INTEGER DEFAULT 0 CHECK (filled_quantity >= 0),
    filled_at TIMESTAMPTZ,
    placed_at_virtual_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =======================================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- =======================================================================================
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own positions" ON public.positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own orders" ON public.orders FOR SELECT USING (auth.uid() = user_id);

-- =======================================================================================
-- 4. AUTH TRIGGER (SEEDING WALLET)
-- =======================================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.wallets (user_id, cash_balance, locked_margin)
  VALUES (new.id, 1000000.00, 0.00);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =======================================================================================
-- 5. MATCHING ENGINE CORE (STRICT LOCK ORDERING)
-- =======================================================================================

-- Helper to strictly recalculate locked margins
CREATE OR REPLACE FUNCTION public.recalculate_user_margin(p_user_id UUID)
RETURNS NUMERIC(14, 2) AS $$
DECLARE
    v_total NUMERIC(14, 2);
BEGIN
    SELECT COALESCE(SUM(
        COALESCE(limit_price, 0) * quantity * (CASE WHEN product_type = 'MIS' THEN 0.20 ELSE 1.00 END)
    ), 0.00) INTO v_total
    FROM public.orders
    WHERE user_id = p_user_id AND status IN ('PENDING', 'TRIGGER_PENDING') AND side = 'BUY';

    v_total := v_total + COALESCE((
        SELECT SUM(average_buy_price * quantity * (CASE WHEN product_type = 'MIS' THEN 0.20 ELSE 1.00 END))
        FROM public.positions WHERE user_id = p_user_id AND quantity > 0
    ), 0.00);

    UPDATE public.wallets SET locked_margin = v_total, updated_at = NOW() WHERE user_id = p_user_id;
    RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Place Order
CREATE OR REPLACE FUNCTION public.place_order_with_margin(
    p_user_id UUID, p_symbol VARCHAR(20), p_side order_side, p_order_type order_type, 
    p_product_type product_type, p_quantity INTEGER, p_limit_price NUMERIC(14, 2), 
    p_trigger_price NUMERIC(14, 2), p_stop_loss_price NUMERIC(14, 2), 
    p_virtual_time TIMESTAMPTZ, p_estimated_price NUMERIC(14, 2)
)
RETURNS UUID AS $$
DECLARE
    v_order_id UUID;
    v_req_margin NUMERIC(14, 2) := 0.00;
    v_current_cash NUMERIC(14, 2);
    v_exec_price NUMERIC(14, 2) := COALESCE(p_limit_price, p_estimated_price);
    v_mult NUMERIC(4, 2) := CASE WHEN p_product_type = 'MIS' THEN 0.20 ELSE 1.00 END;
BEGIN
    -- LOCK 1: Wallet
    SELECT cash_balance INTO v_current_cash FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;

    IF p_side = 'BUY' THEN
        v_req_margin := v_exec_price * p_quantity * v_mult;
        IF v_current_cash < v_req_margin THEN
            RAISE EXCEPTION 'Insufficient funds: Required %, Available %', v_req_margin, v_current_cash;
        END IF;
        UPDATE public.wallets 
        SET cash_balance = cash_balance - v_req_margin, locked_margin = locked_margin + v_req_margin 
        WHERE user_id = p_user_id;
    ELSE
        -- LOCK 2: Position (Only required for sells to verify holdings)
        PERFORM 1 FROM public.positions 
        WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = p_product_type AND quantity >= p_quantity 
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Short selling prevented: Insufficient holding for %', p_symbol;
        END IF;
    END IF;

    -- LOCK 3: Insert Order
    INSERT INTO public.orders (
        user_id, symbol, side, order_type, product_type, quantity, limit_price, trigger_price, stop_loss_price, placed_at_virtual_time
    ) VALUES (
        p_user_id, p_symbol, p_side, p_order_type, p_product_type, p_quantity, p_limit_price, p_trigger_price, p_stop_loss_price, p_virtual_time
    ) RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Execute Fill
CREATE OR REPLACE FUNCTION public.execute_order_fill(
    p_order_id UUID, p_fill_price NUMERIC(14, 2), p_fill_time TIMESTAMPTZ
)
RETURNS VOID AS $$
DECLARE
    v_uid UUID; v_sym VARCHAR(20); v_ptype product_type; v_side order_side; v_qty INTEGER;
    v_stat order_status; v_lmt NUMERIC(14, 2);
    v_pos RECORD; v_mult NUMERIC(4, 2); v_margin_diff NUMERIC(14, 2);
BEGIN
    -- Pre-read order metadata to establish lock hierarchy
    SELECT user_id, symbol, product_type, side, quantity, status, limit_price 
    INTO v_uid, v_sym, v_ptype, v_side, v_qty, v_stat, v_lmt 
    FROM public.orders WHERE id = p_order_id;

    IF v_stat = 'FILLED' THEN RETURN; END IF;
    v_mult := CASE WHEN v_ptype = 'MIS' THEN 0.20 ELSE 1.00 END;

    -- LOCK HIERARCHY MUST BE OBEYED: 1. Wallet, 2. Position, 3. Order
    PERFORM 1 FROM public.wallets WHERE user_id = v_uid FOR UPDATE;
    
    IF v_side = 'BUY' THEN
        -- Settle slippage difference between locked margin and actual fill margin
        v_margin_diff := (COALESCE(v_lmt, p_fill_price) * v_qty * v_mult) - (p_fill_price * v_qty * v_mult);
        IF v_margin_diff <> 0 THEN
            UPDATE public.wallets SET cash_balance = cash_balance + v_margin_diff, locked_margin = locked_margin - v_margin_diff WHERE user_id = v_uid;
        END IF;

        -- Lock & Upsert Position
        INSERT INTO public.positions (user_id, symbol, product_type, quantity, average_buy_price)
        VALUES (v_uid, v_sym, v_ptype, v_qty, p_fill_price)
        ON CONFLICT (user_id, symbol, product_type) DO UPDATE SET
            average_buy_price = ((positions.quantity * positions.average_buy_price) + (EXCLUDED.quantity * p_fill_price)) / (positions.quantity + EXCLUDED.quantity),
            quantity = positions.quantity + EXCLUDED.quantity, updated_at = NOW();
    ELSE
        -- Lock Position for Sell
        SELECT * INTO v_pos FROM public.positions WHERE user_id = v_uid AND symbol = v_sym AND product_type = v_ptype FOR UPDATE;
        
        -- Release cash: returned margin + realized PnL
        UPDATE public.wallets SET cash_balance = cash_balance + (v_pos.average_buy_price * v_qty * v_mult) + ((p_fill_price - v_pos.average_buy_price) * v_qty) WHERE user_id = v_uid;
        
        -- Update Position
        UPDATE public.positions SET 
            quantity = v_pos.quantity - v_qty, 
            average_sell_price = CASE WHEN v_pos.average_sell_price = 0 THEN p_fill_price ELSE (v_pos.average_sell_price + p_fill_price) / 2.0 END,
            realized_pnl = v_pos.realized_pnl + ((p_fill_price - v_pos.average_buy_price) * v_qty), updated_at = NOW()
        WHERE id = v_pos.id;
    END IF;

    -- Lock & Update Order
    UPDATE public.orders SET status = 'FILLED', filled_price = p_fill_price, filled_quantity = v_qty, filled_at = p_fill_time, updated_at = NOW() WHERE id = p_order_id;

    -- Invariant Guard
    PERFORM public.recalculate_user_margin(v_uid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Square Off
CREATE OR REPLACE FUNCTION public.square_off_position(
    p_user_id UUID, p_symbol VARCHAR(20), p_product_type product_type, p_exit_price NUMERIC(14, 2), p_exit_time TIMESTAMPTZ
)
RETURNS UUID AS $$
DECLARE
    v_qty INTEGER; v_order_id UUID;
BEGIN
    SELECT quantity INTO v_qty FROM public.positions WHERE user_id = p_user_id AND symbol = p_symbol AND product_type = p_product_type;
    IF v_qty IS NULL OR v_qty <= 0 THEN RETURN NULL; END IF;

    v_order_id := public.place_order_with_margin(p_user_id, p_symbol, 'SELL'::order_side, 'MARKET'::order_type, p_product_type, v_qty, p_exit_price, NULL, NULL, p_exit_time, p_exit_price);
    PERFORM public.execute_order_fill(v_order_id, p_exit_price, p_exit_time);
    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;