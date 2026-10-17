begin;

create table public.category_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  distance_km numeric(6,2) not null check (distance_km > 0),
  min_age integer check (min_age is null or min_age between 0 and 120),
  max_age integer check (max_age is null or max_age between 0 and 120),
  gender_rule text not null default 'any' check (gender_rule in ('any', 'female', 'male')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_age is null or min_age is null or max_age >= min_age)
);

insert into public.category_catalog (name, distance_km, min_age, max_age, gender_rule)
select distinct name, distance_km, min_age, max_age, gender_rule
from public.categories;

alter table public.categories
  add column catalog_category_id uuid;

update public.categories as edition_category
set catalog_category_id = catalog.id
from public.category_catalog as catalog
where catalog.name = edition_category.name
  and catalog.distance_km = edition_category.distance_km
  and catalog.min_age is not distinct from edition_category.min_age
  and catalog.max_age is not distinct from edition_category.max_age
  and catalog.gender_rule = edition_category.gender_rule;

alter table public.categories
  alter column catalog_category_id set not null,
  add constraint categories_catalog_category_fk
    foreign key (catalog_category_id) references public.category_catalog(id) on delete restrict;

create index categories_catalog_category_idx on public.categories (catalog_category_id);
create trigger category_catalog_updated_at before update on public.category_catalog
for each row execute function public.set_updated_at();

alter table public.category_catalog enable row level security;
create policy category_catalog_manager_read on public.category_catalog
  for select to authenticated using (public.is_admin_manager());
create policy category_catalog_manager_write on public.category_catalog
  for all to authenticated using (public.is_admin_manager())
  with check (public.is_admin_manager());
grant select, insert on public.category_catalog to authenticated;
revoke update, delete on public.category_catalog from authenticated;

create or replace function public.sync_edition_categories(
  p_edition_id uuid,
  p_catalog_category_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_catalog_category_ids is null then
    raise exception 'Category selection is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.editions where id = p_edition_id) then
    raise exception 'Edition not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(p_catalog_category_ids) as selected(id)
    left join public.category_catalog as catalog on catalog.id = selected.id
    where catalog.id is null
  ) then
    raise exception 'A selected category does not exist' using errcode = '22023';
  end if;

  update public.categories as edition_category
  set is_active = edition_category.catalog_category_id = any(p_catalog_category_ids)
  where edition_category.edition_id = p_edition_id;

  insert into public.categories (
    edition_id, catalog_category_id, name, distance_km, min_age, max_age,
    gender_rule, price_cents, capacity, shirt_options, is_active
  )
  select p_edition_id, catalog.id, catalog.name, catalog.distance_km,
    catalog.min_age, catalog.max_age, catalog.gender_rule, 0, null, '{}', true
  from public.category_catalog as catalog
  where catalog.id = any(p_catalog_category_ids)
    and not exists (
      select 1 from public.categories as edition_category
      where edition_category.edition_id = p_edition_id
        and edition_category.catalog_category_id = catalog.id
    );
end;
$$;

create or replace function public.create_edition_with_categories(
  p_year integer,
  p_name text,
  p_catalog_category_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_edition_id uuid := extensions.gen_random_uuid();
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_year is null or p_name is null
    or p_year not between 2000 and 2200
    or length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid edition data' using errcode = '22023';
  end if;

  insert into public.editions (id, year, name, status)
    values (v_edition_id, p_year, trim(p_name), 'draft');
  insert into public.edition_public_settings (edition_id) values (v_edition_id);
  insert into public.edition_counters (edition_id, last_number) values (v_edition_id, 0);
  perform public.sync_edition_categories(v_edition_id, p_catalog_category_ids);
  return v_edition_id;
end;
$$;

create or replace function public.update_edition_with_categories(
  p_edition_id uuid,
  p_year integer,
  p_name text,
  p_status text,
  p_catalog_category_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_edition_id is null or p_year is null or p_name is null or p_status is null
    or p_year not between 2000 and 2200
    or length(trim(p_name)) not between 1 and 120
    or p_status not in ('draft', 'open', 'closed', 'archived') then
    raise exception 'Invalid edition data' using errcode = '22023';
  end if;

  update public.editions
  set year = p_year, name = trim(p_name), status = p_status
  where id = p_edition_id;
  if not found then
    raise exception 'Edition not found' using errcode = 'P0002';
  end if;
  perform public.sync_edition_categories(p_edition_id, p_catalog_category_ids);
end;
$$;

create or replace function public.update_category_catalog(
  p_category_id uuid,
  p_name text,
  p_distance_km numeric,
  p_min_age integer,
  p_max_age integer,
  p_gender_rule text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_name is null or p_distance_km is null or p_gender_rule is null then
    raise exception 'Category data is required' using errcode = '22023';
  end if;
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if length(trim(p_name)) not between 1 and 100
    or p_distance_km <= 0
    or p_min_age not between 0 and 120 and p_min_age is not null
    or p_max_age not between 0 and 120 and p_max_age is not null
    or p_min_age is not null and p_max_age is not null and p_min_age > p_max_age
    or p_gender_rule not in ('any', 'female', 'male') then
    raise exception 'Invalid category data' using errcode = '22023';
  end if;

  update public.category_catalog as catalog
  set name = trim(p_name),
      distance_km = p_distance_km,
      min_age = p_min_age,
      max_age = p_max_age,
      gender_rule = p_gender_rule
  where catalog.id = p_category_id;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;

  update public.categories as edition_category
  set name = trim(p_name),
      distance_km = p_distance_km,
      min_age = p_min_age,
      max_age = p_max_age,
      gender_rule = p_gender_rule
  where edition_category.catalog_category_id = p_category_id;
end;
$$;

create or replace function public.delete_category_catalog(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.categories as edition_category
    join public.registrations as registration on registration.category_id = edition_category.id
    where edition_category.catalog_category_id = p_category_id
  ) then
    raise exception 'Category is used by registrations and cannot be deleted' using errcode = '23503';
  end if;

  delete from public.categories where catalog_category_id = p_category_id;
  delete from public.category_catalog where id = p_category_id;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
end;
$$;

drop function if exists public.set_edition_available_categories(uuid, uuid[]);
drop function if exists public.clone_edition(uuid, integer, text);

revoke all on function public.sync_edition_categories(uuid, uuid[]) from public, anon;
grant execute on function public.sync_edition_categories(uuid, uuid[]) to authenticated;
revoke all on function public.create_edition_with_categories(integer, text, uuid[]) from public, anon;
grant execute on function public.create_edition_with_categories(integer, text, uuid[]) to authenticated;
revoke all on function public.update_edition_with_categories(uuid, integer, text, text, uuid[]) from public, anon;
grant execute on function public.update_edition_with_categories(uuid, integer, text, text, uuid[]) to authenticated;
revoke all on function public.update_category_catalog(uuid, text, numeric, integer, integer, text) from public, anon;
grant execute on function public.update_category_catalog(uuid, text, numeric, integer, integer, text) to authenticated;
revoke all on function public.delete_category_catalog(uuid) from public, anon;
grant execute on function public.delete_category_catalog(uuid) to authenticated;

commit;
