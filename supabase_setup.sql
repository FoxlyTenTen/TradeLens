-- 1. Create the user_constraints table
CREATE TABLE public.user_constraints (
    user_id TEXT PRIMARY KEY, -- Matches the 'Good_Trader' or 'Bad_Trader' IDs
    max_daily_loss NUMERIC DEFAULT 50.00,
    max_daily_trades INT DEFAULT 10,
    risk_per_trade_pct NUMERIC DEFAULT 2.0, -- e.g., 2%
    max_consecutive_losses INT DEFAULT 3,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Realtime events for this table (so the UI updates instantly)
alter publication supabase_realtime add table public.user_constraints;

-- 3. Enable Row Level Security (RLS)
alter table public.user_constraints enable row level security;

-- 4. Create a policy to allow all access (for demo purposes)
create policy "Enable all access for all users"
on public.user_constraints
for all
using (true)
with check (true);

-- 5. Insert default constraints for our demo users
INSERT INTO public.user_constraints (user_id, max_daily_loss, max_daily_trades, risk_per_trade_pct, max_consecutive_losses)
VALUES 
    ('Good_Trader', 100.00, 20, 1.5, 5)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.user_constraints (user_id, max_daily_loss, max_daily_trades, risk_per_trade_pct, max_consecutive_losses)
VALUES 
    ('Bad_Trader', 50.00, 50, 5.0, 10)
ON CONFLICT (user_id) DO NOTHING;
