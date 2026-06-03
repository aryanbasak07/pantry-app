-- Pantry & Spend — Phase 2 schema (shared households + items, with RLS).
-- Run this once in your Supabase project: SQL Editor → paste → Run.

-- ---------- Tables ----------
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Our Kitchen',
  invite_code text unique not null,
  created_at  timestamptz not null default now()
);

create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name          text not null,
  category      text not null,
  qty           numeric,
  unit          text,
  status        text not null default 'to_buy',   -- to_buy | in_stock | used
  added_by      text,
  purchased_date date,
  expiry_date   date,
  freshness_days int not null default 7,
  notes         text default '',
  wasted        boolean default false,
  used_date     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists items_household_idx on items(household_id);

-- keep updated_at fresh (used for conflict-free last-write-wins sync)
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists items_touch on items;
create trigger items_touch before update on items
  for each row execute function touch_updated_at();

-- ---------- Membership helper ----------
create or replace function is_member(h uuid) returns boolean as $$
  select exists (
    select 1 from household_members
    where household_id = h and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- ---------- Row Level Security ----------
alter table households        enable row level security;
alter table household_members enable row level security;
alter table items             enable row level security;

drop policy if exists hh_read on households;
create policy hh_read on households for select using (is_member(id));

drop policy if exists hm_read on household_members;
create policy hm_read on household_members for select
  using (is_member(household_id) or user_id = auth.uid());

drop policy if exists items_all on items;
create policy items_all on items for all
  using (is_member(household_id))
  with check (is_member(household_id));

-- ---------- Create / join household (security definer to bypass RLS bootstrap) ----------
create or replace function create_household(p_name text, p_member_name text)
returns households as $$
declare h households;
begin
  insert into households(name, invite_code)
    values (coalesce(nullif(p_name,''), 'Our Kitchen'),
            upper(substr(md5(gen_random_uuid()::text), 1, 6)))
    returning * into h;
  insert into household_members(household_id, user_id, name)
    values (h.id, auth.uid(), p_member_name);
  return h;
end; $$ language plpgsql security definer;

create or replace function join_household(p_code text, p_member_name text)
returns households as $$
declare h households;
begin
  select * into h from households where invite_code = upper(p_code);
  if h.id is null then raise exception 'Invalid invite code'; end if;
  insert into household_members(household_id, user_id, name)
    values (h.id, auth.uid(), p_member_name)
    on conflict (household_id, user_id) do update set name = excluded.name;
  return h;
end; $$ language plpgsql security definer;

-- ---------- Realtime (instant sync between phones) ----------
alter publication supabase_realtime add table items;
