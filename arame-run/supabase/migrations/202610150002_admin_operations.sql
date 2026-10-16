create unique index admin_profiles_single_primary_idx
  on public.admin_profiles (role)
  where role = 'primary';

create or replace function public.guard_registration_category_change()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_category public.categories%rowtype;
begin
  select * into v_category from public.categories
    where id = new.category_id and edition_id = new.edition_id and is_active
    for update;
  if not found then
    raise exception 'Category is unavailable for this edition' using errcode = '22023';
  end if;
  if v_category.gender_rule <> 'any' and v_category.gender_rule <> new.gender then
    raise exception 'Participant does not meet category gender rule' using errcode = '22023';
  end if;
  if v_category.min_age is not null and
     date_part('year', age(current_date, new.birth_date)) < v_category.min_age then
    raise exception 'Participant is below category minimum age' using errcode = '22023';
  end if;
  if v_category.max_age is not null and
     date_part('year', age(current_date, new.birth_date)) > v_category.max_age then
    raise exception 'Participant exceeds category maximum age' using errcode = '22023';
  end if;
  if cardinality(v_category.shirt_options) > 0
     and not (new.shirt_size = any(v_category.shirt_options)) then
    raise exception 'Invalid shirt size for category' using errcode = '22023';
  end if;
  if new.status = 'active' and v_category.capacity is not null and (
    select count(*) from public.registrations r
    where r.category_id = v_category.id and r.status = 'active' and r.id <> new.id
  ) >= v_category.capacity then
    raise exception 'Category capacity has been reached' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger registration_category_guard
before update of category_id, birth_date, gender, shirt_size on public.registrations
for each row execute function public.guard_registration_category_change();

create or replace function public.prevent_category_capacity_below_occupancy()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.capacity is not null and (
    select count(*) from public.registrations r
    where r.category_id = new.id and r.status = 'active'
  ) > new.capacity then
    raise exception 'Capacity cannot be lower than active registrations' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger category_capacity_guard
before update of capacity on public.categories
for each row execute function public.prevent_category_capacity_below_occupancy();

create or replace function public.prevent_category_rule_conflicts()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.registrations r
    where r.category_id = new.id and r.status = 'active'
      and (
        (new.gender_rule <> 'any' and r.gender <> new.gender_rule)
        or (new.min_age is not null and
          date_part('year', age(current_date, r.birth_date)) < new.min_age)
        or (new.max_age is not null and
          date_part('year', age(current_date, r.birth_date)) > new.max_age)
        or (cardinality(new.shirt_options) > 0 and
          not (r.shirt_size = any(new.shirt_options)))
      )
  ) then
    raise exception 'Category rules conflict with active registrations' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger category_rules_guard
before update of min_age, max_age, gender_rule, shirt_options on public.categories
for each row execute function public.prevent_category_rule_conflicts();

create or replace function public.protect_primary_admin_profile()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.role = 'primary'
     and current_setting('arame.primary_transfer', true) is distinct from 'on' then
    if tg_op = 'DELETE' then
      raise exception 'Transfer primary administrator role before deletion' using errcode = '42501';
    end if;
    if new.role <> 'primary' or not new.is_active then
      raise exception 'Transfer primary administrator role before deactivation' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger primary_admin_profile_guard
before update or delete on public.admin_profiles
for each row execute function public.protect_primary_admin_profile();

create or replace function public.cancel_registration(p_registration_id uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  select category_id into v_category_id from public.registrations
    where id = p_registration_id and status = 'active'
    for update;
  if not found then
    raise exception 'Active registration not found' using errcode = 'P0002';
  end if;
  perform 1 from public.categories where id = v_category_id for update;
  update public.registrations set status = 'cancelled'
    where id = p_registration_id;
end;
$$;

create or replace function public.admin_report(p_edition_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total_active', (
      select count(*) from public.registrations r
      where r.edition_id = p_edition_id and r.status = 'active'
    ),
    'payments_confirmed', (
      select count(*) from public.registrations r
      where r.edition_id = p_edition_id and r.status = 'active'
        and r.payment_status = 'confirmed'
    ),
    'payments_pending', (
      select count(*) from public.registrations r
      where r.edition_id = p_edition_id and r.status = 'active'
        and r.payment_status = 'pending'
    ),
    'capacity', coalesce((
      select sum(c.capacity) from public.categories c
      where c.edition_id = p_edition_id
    ), 0),
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', c2.name,
        'occupied', (
          select count(*) from public.registrations r2
          where r2.category_id = c2.id and r2.status = 'active'
        ),
        'capacity', c2.capacity
      ) order by c2.distance_km, c2.name)
      from public.categories c2
      where c2.edition_id = p_edition_id
    ), '[]'::jsonb)
  ) into result
  from public.editions e where e.id = p_edition_id;
  if result is null then raise exception 'Edition not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.transfer_primary_admin(p_new_primary uuid)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_new_primary = auth.uid() or not exists (
    select 1 from public.admin_profiles
    where user_id = p_new_primary and is_active and role = 'read_only'
  ) then
    raise exception 'Target must be another active read-only administrator' using errcode = '22023';
  end if;
  perform set_config('arame.primary_transfer', 'on', true);
  update public.admin_profiles set role = 'read_only' where user_id = auth.uid();
  update public.admin_profiles set role = 'primary' where user_id = p_new_primary;
end;
$$;

create or replace function public.admin_export_page(
  p_edition_id uuid,
  p_limit integer,
  p_offset integer
)
returns table (
  registration_number bigint,
  full_name text,
  category_name text,
  amount_due_cents integer,
  payment_status public.payment_status,
  registration_status public.registration_status,
  created_at timestamptz
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 1000 or p_offset < 0 then
    raise exception 'Invalid export page' using errcode = '22023';
  end if;
  return query
    select r.registration_number, r.full_name, c.name, r.amount_due_cents,
      r.payment_status, r.status, r.created_at
    from public.registrations r
    join public.categories c on c.id = r.category_id
    where r.edition_id = p_edition_id
    order by r.registration_number
    limit p_limit offset p_offset;
end;
$$;

revoke all on function public.guard_registration_category_change() from public, anon, authenticated;
revoke all on function public.prevent_category_capacity_below_occupancy() from public, anon, authenticated;
revoke all on function public.prevent_category_rule_conflicts() from public, anon, authenticated;
revoke all on function public.protect_primary_admin_profile() from public, anon, authenticated;
revoke all on function public.cancel_registration(uuid) from public, anon;
grant execute on function public.cancel_registration(uuid) to authenticated;
revoke all on function public.admin_report(uuid) from public, anon;
grant execute on function public.admin_report(uuid) to authenticated;
revoke all on function public.transfer_primary_admin(uuid) from public, anon;
grant execute on function public.transfer_primary_admin(uuid) to authenticated;
revoke all on function public.admin_export_page(uuid, integer, integer) from public, anon;
grant execute on function public.admin_export_page(uuid, integer, integer) to authenticated;

revoke update on public.registrations from authenticated;
revoke update (status) on public.registrations from authenticated;
grant update (full_name, phone_e164, birth_date, gender, category_id, shirt_size)
  on public.registrations to authenticated;
