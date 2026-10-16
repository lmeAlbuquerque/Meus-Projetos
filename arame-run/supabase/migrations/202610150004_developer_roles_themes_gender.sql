begin;

drop index if exists public.admin_profiles_single_primary_idx;
alter table public.admin_profiles
  alter column role type text using role::text;
alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role in ('developer', 'primary', 'read_only'));

select set_config('arame.primary_transfer', 'on', true);
update public.admin_profiles
set role = 'developer'
where role = 'primary'
  and not exists (
    select 1 from public.admin_profiles where role = 'developer'
  );

create unique index admin_profiles_single_primary_idx
  on public.admin_profiles (role) where role = 'primary';
create unique index admin_profiles_single_developer_idx
  on public.admin_profiles (role) where role = 'developer';

create or replace function public.is_developer()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.user_id = (select auth.uid())
      and a.is_active and a.role = 'developer'
  );
$$;

create or replace function public.is_admin_manager()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select public.is_developer() or exists (
    select 1 from public.admin_profiles a
    where a.user_id = (select auth.uid())
      and a.is_active and a.role = 'primary'
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.user_id = (select auth.uid()) and a.is_active
  );
$$;

create or replace function public.is_primary_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles a
    where a.user_id = (select auth.uid())
      and a.is_active and a.role = 'primary'
  );
$$;

do $$
declare
  function_row record;
  definition text;
begin
  for function_row in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc like '%is_primary_admin()%'
      and p.proname <> 'is_primary_admin'
      and p.proname <> 'transfer_primary_admin'
  loop
    definition := pg_get_functiondef(function_row.signature);
    definition := replace(definition, 'public.is_primary_admin()', 'public.is_admin_manager()');
    execute definition;
  end loop;
end;
$$;

create table public.admin_role_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  previous_role text not null check (previous_role in ('developer', 'primary', 'read_only')),
  new_role text not null check (new_role in ('developer', 'primary', 'read_only')),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now()
);
alter table public.admin_role_audit enable row level security;
create policy admin_role_audit_developer_read on public.admin_role_audit
  for select to authenticated using (public.is_developer());
revoke all on public.admin_role_audit from public, anon, authenticated;
grant select on public.admin_role_audit to authenticated;

create or replace function public.set_primary_admin(p_user_id uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  current_primary public.admin_profiles%rowtype;
  new_primary public.admin_profiles%rowtype;
  has_current_primary boolean;
begin
  if not public.is_developer() then
    raise exception 'Developer access required' using errcode = '42501';
  end if;

  select * into new_primary
  from public.admin_profiles
  where user_id = p_user_id and is_active and role = 'read_only'
  for update;
  if not found then
    raise exception 'Target must be an active secondary administrator' using errcode = '22023';
  end if;

  select * into current_primary
  from public.admin_profiles
  where role = 'primary'
  for update;
  has_current_primary := found;

  perform set_config('arame.primary_transfer', 'on', true);
  if has_current_primary then
    update public.admin_profiles set role = 'read_only'
    where user_id = current_primary.user_id;
    insert into public.admin_role_audit (user_id, previous_role, new_role, changed_by)
    values (current_primary.user_id, 'primary', 'read_only', auth.uid());
  end if;

  update public.admin_profiles set role = 'primary'
  where user_id = p_user_id;
  insert into public.admin_role_audit (user_id, previous_role, new_role, changed_by)
  values (p_user_id, 'read_only', 'primary', auth.uid());
end;
$$;

create or replace function public.transfer_primary_admin(p_new_primary uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.set_primary_admin(p_new_primary);
end;
$$;

drop policy if exists admins_read_admins on public.admin_profiles;
create policy admins_read_admins on public.admin_profiles
  for select to authenticated
  using (
    public.is_developer()
    or (public.is_admin() and role <> 'developer')
    or user_id = (select auth.uid())
  );
drop policy if exists admins_primary_write on public.admin_profiles;
create policy admins_primary_write on public.admin_profiles
  for update to authenticated
  using (public.is_admin_manager() and role = 'read_only')
  with check (public.is_admin_manager() and role = 'read_only');

drop policy if exists editions_primary_insert on public.editions;
create policy editions_primary_insert on public.editions
  for insert to authenticated with check (public.is_admin_manager());
drop policy if exists editions_primary_update on public.editions;
create policy editions_primary_update on public.editions
  for update to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
drop policy if exists public_settings_primary_write on public.edition_public_settings;
create policy public_settings_primary_write on public.edition_public_settings
  for all to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
drop policy if exists categories_primary_write on public.categories;
create policy categories_primary_write on public.categories
  for all to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
drop policy if exists registrations_primary_insert on public.registrations;
create policy registrations_primary_insert on public.registrations
  for insert to authenticated with check (public.is_admin_manager());
drop policy if exists registrations_primary_update on public.registrations;
create policy registrations_primary_update on public.registrations
  for update to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
drop policy if exists registrations_primary_delete on public.registrations;
create policy registrations_primary_delete on public.registrations
  for delete to authenticated using (public.is_admin_manager());
drop policy if exists payment_audit_primary_insert on public.payment_audit;
create policy payment_audit_primary_insert on public.payment_audit
  for insert to authenticated with check (public.is_admin_manager());

revoke insert, delete on public.admin_profiles from authenticated;
revoke update on public.admin_profiles from authenticated;
grant update (is_active) on public.admin_profiles to authenticated;
revoke all on function public.is_developer() from public, anon;
revoke all on function public.is_admin_manager() from public, anon;
grant execute on function public.is_developer() to authenticated;
grant execute on function public.is_admin_manager() to authenticated;
revoke all on function public.set_primary_admin(uuid) from public, anon;
grant execute on function public.set_primary_admin(uuid) to authenticated;

create table public.app_theme_settings (
  singleton boolean primary key default true check (singleton),
  theme text not null default 'arame' check (theme in ('arame', 'ember', 'sunset')),
  updated_at timestamptz not null default now()
);
insert into public.app_theme_settings (singleton, theme) values (true, 'arame');
alter table public.app_theme_settings enable row level security;
create policy app_theme_public_read on public.app_theme_settings
  for select to anon, authenticated using (true);
create policy app_theme_admin_update on public.app_theme_settings
  for update to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
grant select on public.app_theme_settings to anon, authenticated;
grant update (theme) on public.app_theme_settings to authenticated;

do $$
begin
  if exists (
    select 1 from public.registrations
    where gender not in ('female', 'male')
  ) then
    raise exception 'Existing registrations contain gender values other than female/male. Review those records before applying the gender restriction.';
  end if;
end;
$$;
alter table public.registrations
  add constraint registrations_gender_binary_check
  check (gender in ('female', 'male'));

commit;
