begin;

create table public.registration_private_links (
  registration_id uuid primary key references public.registrations(id) on delete cascade,
  token_ciphertext text not null check (
    token_ciphertext ~ '^v1:[0-9a-f]{24}:[0-9a-f]{160}$'
  ),
  created_at timestamptz not null default now()
);

alter table public.registration_private_links enable row level security;
revoke all on public.registration_private_links from public, anon, authenticated;
grant all on public.registration_private_links to service_role;

create or replace function public.create_registration_with_private_link(
  p_edition_id uuid,
  p_category_id uuid,
  p_full_name text,
  p_phone_e164 text,
  p_birth_date date,
  p_gender text,
  p_shirt_size text,
  p_token_hash_hex text,
  p_token_ciphertext text
)
returns table (registration_id uuid, registration_number bigint, edition_name text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_created record;
begin
  if p_token_ciphertext !~ '^v1:[0-9a-f]{24}:[0-9a-f]{160}$' then
    raise exception 'Invalid encrypted registration link' using errcode = '22023';
  end if;
  select * into v_created
  from public.create_registration(
    p_edition_id, p_category_id, p_full_name, p_phone_e164, p_birth_date,
    p_gender, p_shirt_size, p_token_hash_hex
  );
  insert into public.registration_private_links (registration_id, token_ciphertext)
  values (v_created.registration_id, p_token_ciphertext);
  return query select v_created.registration_id, v_created.registration_number, v_created.edition_name;
end;
$$;

create or replace function public.rotate_registration_lookup_token_with_ciphertext(
  p_registration_id uuid,
  p_new_token_hash_hex text,
  p_token_ciphertext text
)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;
  if p_new_token_hash_hex !~ '^[0-9a-f]{64}$'
     or p_token_ciphertext !~ '^v1:[0-9a-f]{24}:[0-9a-f]{160}$' then
    raise exception 'Invalid replacement registration link' using errcode = '22023';
  end if;
  update public.registrations
  set lookup_token_hash = decode(p_new_token_hash_hex, 'hex')
  where id = p_registration_id and status = 'active';
  if not found then raise exception 'Active registration not found' using errcode = 'P0002'; end if;
  insert into public.registration_private_links (registration_id, token_ciphertext)
  values (p_registration_id, p_token_ciphertext)
  on conflict (registration_id) do update
    set token_ciphertext = excluded.token_ciphertext, created_at = now();
end;
$$;

revoke all on function public.create_registration_with_private_link(
  uuid, uuid, text, text, date, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_registration_with_private_link(
  uuid, uuid, text, text, date, text, text, text, text
) to service_role;
revoke all on function public.rotate_registration_lookup_token_with_ciphertext(
  uuid, text, text
) from public, anon;
grant execute on function public.rotate_registration_lookup_token_with_ciphertext(
  uuid, text, text
) to authenticated;
revoke all on function public.rotate_registration_lookup_token(uuid, text)
  from public, anon, authenticated;

commit;
