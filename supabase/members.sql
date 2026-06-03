-- Member management — run once in Supabase SQL Editor (after phase5.sql).
-- Lets household members rename/remove members and transfer ownership.

-- Allow members to update/delete member rows in their own household
drop policy if exists hm_update on household_members;
create policy hm_update on household_members for update
  using (is_member(household_id)) with check (is_member(household_id));
drop policy if exists hm_delete on household_members;
create policy hm_delete on household_members for delete
  using (is_member(household_id));

-- Ownership column + allow members to update the household (e.g. transfer owner)
alter table households add column if not exists owner_user_id uuid;
update households set owner_user_id = (
  select hm.user_id from household_members hm
  where hm.household_id = households.id order by hm.joined_at asc limit 1
) where owner_user_id is null;

drop policy if exists hh_update on households;
create policy hh_update on households for update
  using (is_member(id)) with check (is_member(id));

-- New households record their creator as owner
create or replace function create_household(p_name text, p_member_name text)
returns households as $$
declare h households; newc text;
begin
  loop newc := gen_invite_code(); exit when not exists (select 1 from households where invite_code = newc); end loop;
  insert into households(name, invite_code, owner_user_id)
    values (coalesce(nullif(p_name,''),'Our Kitchen'), newc, auth.uid()) returning * into h;
  insert into household_members(household_id, user_id, name) values (h.id, auth.uid(), p_member_name);
  return h;
end; $$ language plpgsql security definer;
