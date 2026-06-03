-- Phase 3 — spend tracking. Run once in Supabase (SQL Editor), after schema.sql.

create table if not exists receipts (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  store         text,
  purchased_date date,
  currency      text,
  total         numeric,
  line_items    jsonb not null default '[]',   -- [{name, qty, price, category}]
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists receipts_household_idx on receipts(household_id);

alter table receipts enable row level security;
drop policy if exists receipts_all on receipts;
create policy receipts_all on receipts for all
  using (is_member(household_id)) with check (is_member(household_id));

alter publication supabase_realtime add table receipts;
