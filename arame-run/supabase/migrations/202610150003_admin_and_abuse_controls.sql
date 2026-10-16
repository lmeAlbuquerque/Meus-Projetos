alter table public.admin_profiles add column email text;
update public.admin_profiles a
set email = u.email
from auth.users u
where u.id = a.user_id;
alter table public.admin_profiles alter column email set not null;
alter table public.admin_profiles
  add constraint admin_profiles_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

create table public.public_signup_rate_limits (
  fingerprint bytea primary key check (octet_length(fingerprint) = 32),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0)
);
create index public_signup_rate_limits_window_idx
  on public.public_signup_rate_limits (window_started_at);
alter table public.public_signup_rate_limits enable row level security;
revoke all on public.public_signup_rate_limits from public, anon, authenticated;

create or replace function public.consume_public_rate_limit(
  p_fingerprint_hex text,
  p_max_attempts integer
)
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('hour', clock_timestamp());
  v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Server role required' using errcode = '42501';
  end if;
  if p_fingerprint_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request fingerprint' using errcode = '22023';
  end if;
  if p_max_attempts not between 1 and 60 then
    raise exception 'Invalid rate limit' using errcode = '22023';
  end if;

  insert into public.public_signup_rate_limits as current_limit
    (fingerprint, window_started_at, attempt_count)
  values (decode(p_fingerprint_hex, 'hex'), v_window, 1)
  on conflict (fingerprint) do update
    set window_started_at = case
          when current_limit.window_started_at < v_window
            then v_window
          else current_limit.window_started_at
        end,
        attempt_count = case
          when current_limit.window_started_at < v_window
            then 1
          else current_limit.attempt_count + 1
        end
  returning attempt_count into v_count;

  if mod(extract(epoch from clock_timestamp())::bigint, 64) = 0 then
    delete from public.public_signup_rate_limits
    where window_started_at < clock_timestamp() - interval '24 hours';
  end if;
  return v_count <= p_max_attempts;
end;
$$;

create or replace function public.create_edition(
  p_year integer,
  p_name text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid := extensions.gen_random_uuid();
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2200 or length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid edition data' using errcode = '22023';
  end if;
  insert into public.editions (id, year, name, status)
    values (v_id, p_year, trim(p_name), 'draft');
  insert into public.edition_public_settings (edition_id) values (v_id);
  insert into public.edition_counters (edition_id, last_number) values (v_id, 0);
  return v_id;
end;
$$;

create or replace function public.clone_edition(
  p_source_edition_id uuid,
  p_year integer,
  p_name text
)
returns uuid language plpgsql security definer
set search_path = ''
as $$
declare
  v_source public.editions%rowtype;
  v_new_id uuid := extensions.gen_random_uuid();
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2200 or length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid edition data' using errcode = '22023';
  end if;
  select * into v_source from public.editions where id = p_source_edition_id;
  if not found then raise exception 'Source edition not found' using errcode = 'P0002'; end if;

  insert into public.editions (id, year, name, status)
    values (v_new_id, p_year, trim(p_name), 'draft');
  insert into public.edition_counters (edition_id, last_number) values (v_new_id, 0);
  insert into public.edition_public_settings (
    edition_id, pix_instructions, whatsapp_number, announcement_url,
    show_announcement_on_completion
  )
  select v_new_id, coalesce(s.pix_instructions, ''), coalesce(s.whatsapp_number, ''),
    coalesce(s.announcement_url, ''), coalesce(s.show_announcement_on_completion, true)
  from (values (1)) as seed(row_id)
  left join public.edition_public_settings s on s.edition_id = p_source_edition_id;
  insert into public.categories (
    edition_id, name, distance_km, min_age, max_age, gender_rule,
    price_cents, capacity, shirt_options, is_active
  )
  select v_new_id, name, distance_km, min_age, max_age, gender_rule,
    price_cents, capacity, shirt_options, is_active
  from public.categories where edition_id = p_source_edition_id;
  return v_new_id;
end;
$$;

create or replace function public.rotate_registration_lookup_token(
  p_registration_id uuid,
  p_new_token_hash_hex text
)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_primary_admin() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_new_token_hash_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid replacement token' using errcode = '22023';
  end if;
  update public.registrations
  set lookup_token_hash = decode(p_new_token_hash_hex, 'hex')
  where id = p_registration_id and status = 'active';
  if not found then raise exception 'Active registration not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.consume_public_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer) to service_role;
revoke all on function public.create_edition(integer, text) from public, anon;
grant execute on function public.create_edition(integer, text) to authenticated;
revoke all on function public.clone_edition(uuid, integer, text) from public, anon;
grant execute on function public.clone_edition(uuid, integer, text) to authenticated;
revoke all on function public.rotate_registration_lookup_token(uuid, text) from public, anon;
grant execute on function public.rotate_registration_lookup_token(uuid, text) to authenticated;

revoke insert, update, delete on public.admin_profiles from authenticated;
grant select on public.admin_profiles to authenticated;
grant update (is_active) on public.admin_profiles to authenticated;
grant insert (user_id, role, is_active, created_by, email) on public.admin_profiles to authenticated;
