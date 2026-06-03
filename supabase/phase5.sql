-- Phase 5 — data integrity + stronger pairing. Run once in Supabase SQL Editor.

-- ---------- CHECK constraints (reject bad data at the DB) ----------
alter table items drop constraint if exists items_status_chk;
alter table items add constraint items_status_chk check (status in ('to_buy','in_stock','used'));
alter table items drop constraint if exists items_category_chk;
alter table items add constraint items_category_chk check (category in ('vegetables','fruits','meat','packaged','dry'));
alter table items drop constraint if exists items_qty_chk;
alter table items add constraint items_qty_chk check (qty is null or qty >= 0);
alter table items drop constraint if exists items_fresh_chk;
alter table items add constraint items_fresh_chk check (freshness_days >= 1);
alter table receipts drop constraint if exists receipts_total_chk;
alter table receipts add constraint receipts_total_chk check (total is null or total >= 0);

-- ---------- Stronger invite codes (8 chars, no ambiguous letters) ----------
alter table households add column if not exists invite_code_expires_at timestamptz;

create or replace function gen_invite_code() returns text as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text := ''; i int;
begin
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end; $$ language plpgsql;

-- Regenerate a household's code (members only).
create or replace function rotate_invite_code(p_household uuid) returns households as $$
declare h households; newc text;
begin
  if not is_member(p_household) then raise exception 'Not a member'; end if;
  loop newc := gen_invite_code(); exit when not exists (select 1 from households where invite_code = newc); end loop;
  update households set invite_code = newc, invite_code_expires_at = null where id = p_household returning * into h;
  return h;
end; $$ language plpgsql security definer;

-- create_household now uses the stronger generator.
create or replace function create_household(p_name text, p_member_name text)
returns households as $$
declare h households; newc text;
begin
  loop newc := gen_invite_code(); exit when not exists (select 1 from households where invite_code = newc); end loop;
  insert into households(name, invite_code) values (coalesce(nullif(p_name,''),'Our Kitchen'), newc) returning * into h;
  insert into household_members(household_id, user_id, name) values (h.id, auth.uid(), p_member_name);
  return h;
end; $$ language plpgsql security definer;

-- join is case-insensitive and rejects expired codes.
create or replace function join_household(p_code text, p_member_name text)
returns households as $$
declare h households;
begin
  select * into h from households where upper(invite_code) = upper(trim(p_code));
  if h.id is null then raise exception 'Invalid invite code'; end if;
  if h.invite_code_expires_at is not null and h.invite_code_expires_at < now() then raise exception 'Invite code expired'; end if;
  insert into household_members(household_id, user_id, name) values (h.id, auth.uid(), p_member_name)
    on conflict (household_id, user_id) do update set name = excluded.name;
  return h;
end; $$ language plpgsql security definer;
