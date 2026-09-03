-- 1. ENABLE ROW LEVEL SECURITY ON ALL USER-CENTRIC TABLES
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gtt_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_states ENABLE ROW LEVEL SECURITY;

-- 2. HISTORICAL CANDLES (READ-ONLY PUBLIC DATA)
CREATE POLICY "Allow public read access to historical candles"
ON public.historical_candles
FOR SELECT
USING (true);

-- 3. WALLETS (STRICT USER ISOLATION)
CREATE POLICY "Users can view their own wallet"
ON public.wallets
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Note: Wallets can only be modified via trusted database functions or server-side service role,
-- so no direct UPDATE/INSERT policy is given to client roles.

-- 4. ORDERS POLICIES
CREATE POLICY "Users can view their own orders"
ON public.orders
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pending orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 5. GTT RULES POLICIES
CREATE POLICY "Users can view their own GTT rules"
ON public.gtt_rules
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own GTT rules"
ON public.gtt_rules
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own GTT rules"
ON public.gtt_rules
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 6. POSITIONS POLICIES
CREATE POLICY "Users can view their own positions"
ON public.positions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 7. SIMULATION STATES POLICIES
CREATE POLICY "Users can view and update their own simulation state"
ON public.simulation_states
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 8. AUTOMATIC WALLET & SIMULATION STATE CREATION TRIGGER ON SIGNUP
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.wallets (user_id, cash_balance, locked_margin)
    VALUES (NEW.id, 1000000.00, 0.00);

    INSERT INTO public.simulation_states (user_id, current_virtual_time, is_playing, playback_speed)
    VALUES (NEW.id, '2024-01-01 09:15:00+05:30', false, 1);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();