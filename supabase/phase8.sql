-- Phase 8 — recipes + weekly meal plan. Run once in Supabase SQL Editor.

create table if not exists recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name         text not null,
  servings     int,
  ingredients  jsonb not null default '[]',   -- [{name, qty, unit, category}]
  steps        jsonb not null default '[]',   -- [text]
  source       text default 'manual',         -- 'manual' | 'ai'
  tags         jsonb not null default '[]',
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists recipes_household_idx on recipes(household_id);
alter table recipes enable row level security;
drop policy if exists recipes_all on recipes;
create policy recipes_all on recipes for all using (is_member(household_id)) with check (is_member(household_id));

create table if not exists meal_plan (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date         date not null,
  recipe_id    uuid references recipes(id) on delete set null,
  title        text not null,
  created_at   timestamptz not null default now()
);
create index if not exists meal_plan_household_idx on meal_plan(household_id, date);
alter table meal_plan enable row level security;
drop policy if exists meal_plan_all on meal_plan;
create policy meal_plan_all on meal_plan for all using (is_member(household_id)) with check (is_member(household_id));

alter publication supabase_realtime add table recipes;
alter publication supabase_realtime add table meal_plan;
