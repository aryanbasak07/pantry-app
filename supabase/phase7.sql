-- Phase 7 — budgeting, custom spend categories, couple accounting. Run once.

-- Who paid + how it's split (shared 50/50 or personal/not-split)
alter table receipts add column if not exists paid_by text;
alter table receipts add column if not exists split text not null default 'shared';
alter table receipts drop constraint if exists receipts_split_chk;
alter table receipts add constraint receipts_split_chk check (split in ('shared', 'personal'));

-- Custom spend categories (e.g. cigarettes, household), household-scoped
create table if not exists spend_categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  unique (household_id, name)
);
alter table spend_categories enable row level security;
drop policy if exists spend_cat_all on spend_categories;
create policy spend_cat_all on spend_categories for all
  using (is_member(household_id)) with check (is_member(household_id));

-- Monthly budgets; category 'TOTAL' = overall budget
create table if not exists budgets (
  household_id uuid not null references households(id) on delete cascade,
  category     text not null,
  monthly      numeric not null check (monthly >= 0),
  primary key (household_id, category)
);
alter table budgets enable row level security;
drop policy if exists budgets_all on budgets;
create policy budgets_all on budgets for all
  using (is_member(household_id)) with check (is_member(household_id));

-- Settle-up payments between members
create table if not exists settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_member  text not null,
  to_member    text not null,
  amount       numeric not null check (amount >= 0),
  date         date not null default current_date,
  created_at   timestamptz not null default now()
);
alter table settlements enable row level security;
drop policy if exists settlements_all on settlements;
create policy settlements_all on settlements for all
  using (is_member(household_id)) with check (is_member(household_id));

alter publication supabase_realtime add table spend_categories;
alter publication supabase_realtime add table budgets;
alter publication supabase_realtime add table settlements;
