-- Phase 4 — push subscriptions for morning notifications. Run once in Supabase.

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid,
  endpoint     text unique not null,
  subscription jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists push_subs_household_idx on push_subscriptions(household_id);

alter table push_subscriptions enable row level security;
drop policy if exists push_subs_all on push_subscriptions;
create policy push_subs_all on push_subscriptions for all
  using (is_member(household_id)) with check (is_member(household_id));
-- The morning cron job reads this table with the service-role key (bypasses RLS).
