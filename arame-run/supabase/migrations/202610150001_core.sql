create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.admin_role as enum ('primary', 'read_only');
create type public.registration_status as enum ('active', 'cancelled');
create type public.payment_status as enum ('pending', 'confirmed', 'refunded');

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique check (year between 2000 and 2200),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed', 'archived')),
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (registration_closes_at is null or registration_opens_at is null
    or registration_closes_at > registration_opens_at)
);

create table public.edition_public_settings (
  edition_id uuid primary key references public.editions(id) on delete restrict,
  pix_instructions text not null default '',
  whatsapp_number text not null default '',
  announcement_url text not null default '',
  show_announcement_on_completion boolean not null default true,
  updated_at timestamptz not null default now(),
  check (whatsapp_number = '' or whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  check (announcement_url = '' or announcement_url ~ '^https://')
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  distance_km numeric(6,2) not null check (distance_km > 0),
  min_age integer check (min_age is null or min_age between 0 and 120),
  max_age integer check (max_age is null or max_age between 0 and 120),
  gender_rule text not null default 'any' check (gender_rule in ('any', 'female', 'male')),
  price_cents integer not null check (price_cents >= 0),
  capacity integer check (capacity is null or capacity > 0),
  shirt_options text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, name),
  check (max_age is null or min_age is null or max_age >= min_age)
);

create table public.edition_counters (
  edition_id uuid primary key references public.editions(id) on delete restrict,
  last_number bigint not null default 0 check (last_number >= 0)
);

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role public.admin_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions(id) on delete restrict,
  registration_number bigint not null check (registration_number > 0),
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  birth_date date not null check (birth_date <= current_date),
  gender text not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  amount_due_cents integer not null check (amount_due_cents >= 0),
  shirt_size text not null default '',
  status public.registration_status not null default 'active',
  payment_status public.payment_status not null default 'pending',
  payment_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lookup_token_hash bytea not null unique check (octet_length(lookup_token_hash) = 32),
  unique (edition_id, registration_number),
  check ((payment_status = 'confirmed') = (payment_confirmed_at is not null))
);

create unique index registrations_duplicate_guard
  on public.registrations (edition_id, lower(trim(full_name)), phone_e164, birth_date)
  where status = 'active';
create index registrations_edition_created_idx
  on public.registrations (edition_id, created_at desc, id);
create index registrations_edition_status_idx
  on public.registrations (edition_id, status, payment_status);
create index registrations_category_idx on public.registrations (category_id);
create index categories_edition_active_idx on public.categories (edition_id, is_active);

create table public.payment_audit (
  id bigint generated always as identity primary key,
  registration_id uuid not null references public.registrations(id) on delete restrict,
  previous_status public.payment_status not null,
  new_status public.payment_status not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  note text not null default '' check (length(note) <= 500)
);
create index payment_audit_registration_idx
  on public.payment_audit (registration_id, changed_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger editions_updated_at before update on public.editions
for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger registration_updated_at before update on public.registrations
for each row execute function public.set_updated_at();
create trigger public_settings_updated_at before update on public.edition_public_settings
for each row execute function public.set_updated_at();

create or replace function public.prevent_registration_reassignment()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.edition_id <> old.edition_id or new.registration_number <> old.registration_number then
    raise exception 'Registration edition and number are immutable';
  end if;
  return new;
end;
$$;
create trigger registration_identity_immutable before update on public.registrations
for each row execute function public.prevent_registration_reassignment();

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
      and a.is_active and a.role = 'primary'::public.admin_role
  );
$$;

create or replace function public.create_registration(
  p_edition_id uuid,
  p_category_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_birth_date date,
  p_gender text,
  p_shirt_size text,
  p_token_hash_hex text
)
returns table (registration_id uuid, registration_number bigint, edition_name text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_edition public.editions%rowtype;
  v_category public.categories%rowtype;
  v_number bigint;
  v_id uuid;
  v_name text;
  v_hash bytea;
begin
  if length(trim(p_full_name)) not between 2 and 160
     or p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
     or p_birth_date > current_date
     or p_gender not in ('female', 'male')
     or length(p_shirt_size) > 20
     or p_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid registration data' using errcode = '22023';
  end if;

  select * into v_edition from public.editions
    where id = p_edition_id and status = 'open'
    for update;
  if not found then
    raise exception 'Edition is not open' using errcode = '22023';
  end if;
  if (v_edition.registration_opens_at is not null and now() < v_edition.registration_opens_at)
     or (v_edition.registration_closes_at is not null and now() > v_edition.registration_closes_at) then
    raise exception 'Registration period is closed' using errcode = '22023';
  end if;

  select * into v_category from public.categories
    where id = p_category_id and edition_id = p_edition_id and is_active
    for update;
  if not found then
    raise exception 'Category is unavailable' using errcode = '22023';
  end if;
  if v_category.gender_rule <> 'any' and v_category.gender_rule <> p_gender then
    raise exception 'Category does not match gender rule' using errcode = '22023';
  end if;
  if v_category.min_age is not null and
     date_part('year', age(current_date, p_birth_date)) < v_category.min_age then
    raise exception 'Participant is below category minimum age' using errcode = '22023';
  end if;
  if v_category.max_age is not null and
     date_part('year', age(current_date, p_birth_date)) > v_category.max_age then
    raise exception 'Participant exceeds category maximum age' using errcode = '22023';
  end if;
  if cardinality(v_category.shirt_options) > 0
     and not (p_shirt_size = any(v_category.shirt_options)) then
    raise exception 'Invalid shirt size' using errcode = '22023';
  end if;
  if v_category.capacity is not null and (
    select count(*) from public.registrations r
    where r.category_id = v_category.id and r.status = 'active'
  ) >= v_category.capacity then
    raise exception 'Category capacity has been reached' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_edition_id::text || '|' || lower(trim(p_full_name)) || '|' ||
      p_phone_e164 || '|' || p_birth_date::text, 0
    )
  );
  if exists (
    select 1 from public.registrations r
    where r.edition_id = p_edition_id and r.status = 'active'
      and lower(trim(r.full_name)) = lower(trim(p_full_name))
      and r.phone_e164 = p_phone_e164 and r.birth_date = p_birth_date
  ) then
    raise exception 'Duplicate active registration' using errcode = '23505';
  end if;

  insert into public.edition_counters (edition_id, last_number)
  values (p_edition_id, 1)
  on conflict (edition_id) do update
    set last_number = public.edition_counters.last_number + 1
  returning last_number into v_number;

  v_hash := decode(p_token_hash_hex, 'hex');
  insert into public.registrations (
    edition_id, registration_number, full_name, phone_e164, birth_date,
    gender, category_id, amount_due_cents, shirt_size, lookup_token_hash
  ) values (
    p_edition_id, v_number, trim(p_full_name), p_phone_e164, p_birth_date,
    p_gender, p_category_id, v_category.price_cents, p_shirt_size, v_hash
  ) returning id into v_id;

  v_name := v_edition.name;
  return query select v_id, v_number, v_name;
end;
$$;

create or replace function public.lookup_registration(p_token_hash_hex text)
returns table (
  edition_name text,
  registration_number bigint,
  participant_name text,
  category_name text,
  payment_status public.payment_status,
  payment_confirmed_at timestamptz,
  announcement_url text,
  whatsapp_number text,
  pix_instructions text,
  show_announcement_on_completion boolean
)
language sql stable security definer
set search_path = ''
as $$
  select e.name, r.registration_number,
    split_part(trim(r.full_name), ' ', 1) ||
      case when position(' ' in trim(r.full_name)) > 0 then ' ' ||
        left(split_part(trim(r.full_name), ' ', 2), 1) || '.' else '' end,
    c.name, r.payment_status, r.payment_confirmed_at,
    coalesce(s.announcement_url, ''), coalesce(s.whatsapp_number, ''),
    coalesce(s.pix_instructions, ''), coalesce(s.show_announcement_on_completion, false)
  from public.registrations r
  join public.editions e on e.id = r.edition_id
  join public.categories c on c.id = r.category_id
  left join public.edition_public_settings s on s.edition_id = e.id
  where p_token_hash_hex ~ '^[0-9a-f]{64}$'
    and r.lookup_token_hash = decode(p_token_hash_hex, 'hex')
    and r.status = 'active'
  limit 1;
$$;

create or replace function public.confirm_registration_payment(
  p_registration_id uuid,
  p_new_status public.payment_status,
  p_note text default ''
)
returns void language plpgsql security definer
set search_path = ''
as $$
declare
  v_old public.payment_status;
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_new_status not in ('pending', 'confirmed', 'refunded')
     or length(p_note) > 500 then
    raise exception 'Invalid payment update' using errcode = '22023';
  end if;
  select payment_status into v_old from public.registrations
    where id = p_registration_id and status = 'active' for update;
  if not found then
    raise exception 'Registration not found' using errcode = 'P0002';
  end if;
  if v_old = 'confirmed' and p_new_status <> 'confirmed'
     and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Correction reason is required' using errcode = '22023';
  end if;
  insert into public.payment_audit (registration_id, previous_status, new_status, changed_by, note)
    values (p_registration_id, v_old, p_new_status, auth.uid(), coalesce(p_note, ''));
  update public.registrations
    set payment_status = p_new_status,
        payment_confirmed_at = case when p_new_status = 'confirmed' then now() else null end
    where id = p_registration_id;
end;
$$;

alter table public.editions enable row level security;
alter table public.edition_public_settings enable row level security;
alter table public.categories enable row level security;
alter table public.edition_counters enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.registrations enable row level security;
alter table public.payment_audit enable row level security;

create policy editions_public_active_read on public.editions
  for select to anon using (status = 'open');
create policy editions_admin_read on public.editions
  for select to authenticated using (public.is_admin());
create policy editions_primary_insert on public.editions
  for insert to authenticated with check (public.is_primary_admin());
create policy editions_primary_update on public.editions
  for update to authenticated using (public.is_primary_admin()) with check (public.is_primary_admin());

create policy public_settings_open_read on public.edition_public_settings
  for select to anon using (
    exists (select 1 from public.editions e where e.id = edition_id and e.status = 'open')
  );
create policy public_settings_admin_read on public.edition_public_settings
  for select to authenticated using (public.is_admin());
create policy public_settings_primary_write on public.edition_public_settings
  for all to authenticated using (public.is_primary_admin())
  with check (public.is_primary_admin());

create policy categories_public_active_read on public.categories
  for select to anon, authenticated using (
    is_active and exists (select 1 from public.editions e where e.id = edition_id and e.status = 'open')
  );
create policy categories_admin_read on public.categories
  for select to authenticated using (public.is_admin());
create policy categories_primary_write on public.categories
  for all to authenticated using (public.is_primary_admin())
  with check (public.is_primary_admin());

create policy admins_read_admins on public.admin_profiles
  for select to authenticated using (public.is_admin());
create policy admins_primary_write on public.admin_profiles
  for all to authenticated using (public.is_primary_admin())
  with check (public.is_primary_admin());

create policy registrations_admin_read on public.registrations
  for select to authenticated using (public.is_admin());
create policy registrations_primary_insert on public.registrations
  for insert to authenticated with check (public.is_primary_admin());
create policy registrations_primary_update on public.registrations
  for update to authenticated using (public.is_primary_admin())
  with check (public.is_primary_admin());
create policy registrations_primary_delete on public.registrations
  for delete to authenticated using (public.is_primary_admin());

create policy payment_audit_admin_read on public.payment_audit
  for select to authenticated using (public.is_admin());
create policy payment_audit_primary_insert on public.payment_audit
  for insert to authenticated with check (public.is_primary_admin());

revoke all on public.edition_counters, public.registrations, public.payment_audit from anon, authenticated;
grant select on public.editions, public.edition_public_settings, public.categories to anon, authenticated;
grant select on public.registrations, public.payment_audit, public.admin_profiles to authenticated;
grant insert, update, delete on public.editions, public.edition_public_settings, public.categories,
  public.admin_profiles to authenticated;
grant update (full_name, phone_e164, birth_date, gender, category_id, shirt_size, status)
  on public.registrations to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_registration_reassignment() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_primary_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_primary_admin() to authenticated;
revoke all on function public.create_registration(uuid, uuid, text, text, date, text, text, text) from public, anon, authenticated;
grant execute on function public.create_registration(uuid, uuid, text, text, date, text, text, text) to service_role;
revoke all on function public.lookup_registration(text) from public, anon, authenticated;
grant execute on function public.lookup_registration(text) to service_role;
revoke all on function public.confirm_registration_payment(uuid, public.payment_status, text) from public, anon;
grant execute on function public.confirm_registration_payment(uuid, public.payment_status, text) to authenticated;
