begin;

alter table public.edition_public_settings
  add column distribute_shirt boolean not null default false,
  add column shirt_options text[] not null default '{}';

with existing_shirts as (
  select c.edition_id, array_agg(distinct shirt order by shirt) as shirt_options
  from public.categories c
  cross join lateral unnest(c.shirt_options) as shirt
  group by c.edition_id
)
update public.edition_public_settings s
set distribute_shirt = true,
    shirt_options = existing_shirts.shirt_options
from existing_shirts
where existing_shirts.edition_id = s.edition_id;

update public.categories c
set shirt_options = s.shirt_options
from public.edition_public_settings s
where s.edition_id = c.edition_id and s.distribute_shirt;

create or replace function public.clone_edition(
  p_source_edition_id uuid,
  p_year integer,
  p_name text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_new_id uuid := extensions.gen_random_uuid();
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2200 or length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid edition data' using errcode = '22023';
  end if;
  if not exists (select 1 from public.editions where id = p_source_edition_id) then
    raise exception 'Source edition not found' using errcode = 'P0002';
  end if;

  insert into public.editions (id, year, name, status)
    values (v_new_id, p_year, trim(p_name), 'draft');
  insert into public.edition_counters (edition_id, last_number) values (v_new_id, 0);
  insert into public.edition_public_settings (
    edition_id, pix_instructions, whatsapp_number, announcement_url,
    show_announcement_on_completion, distribute_shirt, shirt_options
  )
  select v_new_id, coalesce(s.pix_instructions, ''), coalesce(s.whatsapp_number, ''),
    coalesce(s.announcement_url, ''), coalesce(s.show_announcement_on_completion, true),
    coalesce(s.distribute_shirt, false), coalesce(s.shirt_options, '{}'::text[])
  from (values (1)) as seed(row_id)
  left join public.edition_public_settings s on s.edition_id = p_source_edition_id;
  insert into public.categories (
    edition_id, name, distance_km, min_age, max_age, gender_rule,
    price_cents, capacity, shirt_options, is_active
  )
  select v_new_id, name, distance_km, min_age, max_age, gender_rule,
    price_cents, capacity,
    case when exists (
      select 1 from public.edition_public_settings s
      where s.edition_id = p_source_edition_id and s.distribute_shirt
    ) then shirt_options else '{}'::text[] end,
    is_active
  from public.categories where edition_id = p_source_edition_id;
  return v_new_id;
end;
$$;

create or replace function public.admin_registration_page(
  p_edition_id uuid,
  p_search text,
  p_payment text,
  p_status text,
  p_sort text,
  p_ascending boolean,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  registration_number bigint,
  full_name text,
  category_id uuid,
  category_name text,
  amount_due_cents integer,
  payment_status public.payment_status,
  payment_confirmed_at timestamptz,
  status public.registration_status,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_search text := trim(coalesce(p_search, ''));
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0 or length(v_search) > 100 then
    raise exception 'Invalid registration page request' using errcode = '22023';
  end if;
  if p_payment is not null and p_payment not in ('pending', 'confirmed', 'refunded') then
    raise exception 'Invalid payment filter' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('active', 'cancelled') then
    raise exception 'Invalid registration status filter' using errcode = '22023';
  end if;
  if p_sort not in ('registration_number', 'full_name', 'category_name',
                    'payment_status', 'status', 'created_at') then
    raise exception 'Invalid registration sort column' using errcode = '22023';
  end if;

  return query
  select r.id, r.registration_number, r.full_name, r.category_id, c.name,
    r.amount_due_cents, r.payment_status, r.payment_confirmed_at, r.status, r.created_at
  from public.registrations r
  join public.categories c on c.id = r.category_id
  where r.edition_id = p_edition_id
    and (p_payment is null or r.payment_status::text = p_payment)
    and (p_status is null or r.status::text = p_status)
    and (
      v_search = ''
      or position(lower(v_search) in lower(r.full_name)) > 0
      or position(lower(v_search) in lower(c.name)) > 0
      or position(v_search in r.registration_number::text) > 0
    )
  order by
    case when p_sort = 'registration_number' and p_ascending then r.registration_number end asc,
    case when p_sort = 'registration_number' and not p_ascending then r.registration_number end desc,
    case when p_sort = 'full_name' and p_ascending then lower(r.full_name) end asc,
    case when p_sort = 'full_name' and not p_ascending then lower(r.full_name) end desc,
    case when p_sort = 'category_name' and p_ascending then lower(c.name) end asc,
    case when p_sort = 'category_name' and not p_ascending then lower(c.name) end desc,
    case when p_sort = 'payment_status' and p_ascending then r.payment_status::text end asc,
    case when p_sort = 'payment_status' and not p_ascending then r.payment_status::text end desc,
    case when p_sort = 'status' and p_ascending then r.status::text end asc,
    case when p_sort = 'status' and not p_ascending then r.status::text end desc,
    case when p_sort = 'created_at' and p_ascending then r.created_at end asc,
    case when p_sort = 'created_at' and not p_ascending then r.created_at end desc,
    r.id
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.set_edition_shirt_options(
  p_edition_id uuid,
  p_distribute_shirt boolean,
  p_shirt_options text[]
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_options text[] := coalesce(p_shirt_options, '{}'::text[]);
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if cardinality(v_options) > 6 or exists (
    select 1 from unnest(v_options) as shirt(size)
    where shirt.size not in ('PP', 'P', 'M', 'G', 'GG', 'XG')
  ) or cardinality(v_options) <> (
    select count(distinct shirt.size) from unnest(v_options) as shirt(size)
  ) then
    raise exception 'Invalid shirt options' using errcode = '22023';
  end if;
  if p_distribute_shirt and cardinality(v_options) = 0 then
    raise exception 'Select at least one shirt size' using errcode = '22023';
  end if;
  update public.edition_public_settings
  set distribute_shirt = p_distribute_shirt,
      shirt_options = case when p_distribute_shirt then v_options else '{}'::text[] end
  where edition_id = p_edition_id;
  if not found then raise exception 'Edition settings not found' using errcode = 'P0002'; end if;
  update public.categories
  set shirt_options = case when p_distribute_shirt then v_options else '{}'::text[] end
  where edition_id = p_edition_id;
end;
$$;

revoke all on function public.clone_edition(uuid, integer, text) from public, anon;
grant execute on function public.clone_edition(uuid, integer, text) to authenticated;
revoke all on function public.admin_registration_page(
  uuid, text, text, text, text, boolean, integer, integer
) from public, anon;
grant execute on function public.admin_registration_page(
  uuid, text, text, text, text, boolean, integer, integer
) to authenticated;
revoke all on function public.set_edition_shirt_options(uuid, boolean, text[]) from public, anon;
grant execute on function public.set_edition_shirt_options(uuid, boolean, text[]) to authenticated;

commit;
