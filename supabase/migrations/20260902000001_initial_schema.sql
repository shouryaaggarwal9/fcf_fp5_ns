-- 1. ENUMS FOR AUDIT INTEGRITY
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP_LIMIT');
CREATE TYPE product_type AS ENUM ('CNC', 'MIS'); -- CNC = Delivery, MIS = Intraday
CREATE TYPE order_status AS ENUM ('PENDING', 'TRIGGER_PENDING', 'FILLED', 'CANCELLED', 'REJECTED');
CREATE TYPE gtt_status AS ENUM ('ACTIVE', 'TRIGGERED', 'CANCELLED', 'EXPIRED');

-- 2. USER WALLET & LEDGER TABLE
-- Tracks virtual funds with strict non-negative constraints
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 1000000.00 CHECK (cash_balance >= 0), -- Default 10 Lakhs INR
    locked_margin NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (locked_margin >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. STATIC HISTORICAL CANDLES TABLE
-- Stores 5m and 15m bars for our 10 NSE stocks
CREATE TABLE IF NOT EXISTS public.historical_candles (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    timeframe VARCHAR(5) NOT NULL DEFAULT '5m', -- '5m' or '15m'
    timestamp TIMESTAMPTZ NOT NULL,
    open NUMERIC(14, 2) NOT NULL,
    high NUMERIC(14, 2) NOT NULL,
    low NUMERIC(14, 2) NOT NULL,
    close NUMERIC(14, 2) NOT NULL,
    volume BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT unique_symbol_timeframe_timestamp UNIQUE (symbol, timeframe, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup 
ON public.historical_candles (symbol, timeframe, timestamp ASC);

-- 4. ORDERS TABLE (Buy Orders, Intraday/Delivery, SL, Limit)
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    order_type order_type NOT NULL,
    product_type product_type NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    limit_price NUMERIC(14, 2),
    trigger_price NUMERIC(14, 2),
    stop_loss_price NUMERIC(14, 2),
    status order_status NOT NULL DEFAULT 'PENDING',
    filled_price NUMERIC(14, 2),
    filled_quantity INTEGER DEFAULT 0,
    filled_at TIMESTAMPTZ,
    placed_at_virtual_time TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_status 
ON public.orders (user_id, status);

-- 5. GTT (GOOD-TILL-TRIGGERED) RULES TABLE
CREATE TABLE IF NOT EXISTS public.gtt_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    product_type product_type NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    trigger_price NUMERIC(14, 2) NOT NULL,
    limit_price NUMERIC(14, 2) NOT NULL,
    status gtt_status NOT NULL DEFAULT 'ACTIVE',
    triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. POSITIONS & HOLDINGS TABLE
CREATE TABLE IF NOT EXISTS public.positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL,
    product_type product_type NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    average_buy_price NUMERIC(14, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_symbol_product UNIQUE (user_id, symbol, product_type)
);

-- 7. SIMULATION CLOCK STATE PER USER
-- Preserves playback point across tab reloads / closures
CREATE TABLE IF NOT EXISTS public.simulation_states (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    current_virtual_time TIMESTAMPTZ NOT NULL,
    is_playing BOOLEAN NOT NULL DEFAULT FALSE,
    playback_speed INTEGER NOT NULL DEFAULT 1, -- 1x, 5x, 10x
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);