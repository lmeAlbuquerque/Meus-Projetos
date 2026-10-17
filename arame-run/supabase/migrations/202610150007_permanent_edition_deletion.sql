begin;

create table public.deleted_edition_years (
  year integer primary key check (year between 2000 and 2200),
  last_registration_number bigint not null check (last_registration_number >= 0),
  deleted_at timestamptz not null default now(),
  deleted_by uuid not null references auth.users(id) on delete restrict
);

revoke all on public.deleted_edition_years from public, anon, authenticated;

create or replace function public.prevent_deleted_edition_year_reuse()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.deleted_edition_years where year = new.year
  ) then
    raise exception 'Edition year was permanently retired'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger editions_prevent_deleted_year_reuse
before insert or update of year on public.editions
for each row execute function public.prevent_deleted_edition_year_reuse();
revoke all on function public.prevent_deleted_edition_year_reuse() from public, anon, authenticated;

create or replace function public.delete_edition_and_registrations(
  p_edition_id uuid,
  p_confirmation text
)
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  v_edition public.editions%rowtype;
  v_deleted_registrations integer;
begin
  if not public.is_admin_manager() then
    raise exception 'Primary administrator required' using errcode = '42501';
  end if;

  select * into v_edition
  from public.editions
  where id = p_edition_id
  for update;
  if not found then
    raise exception 'Edition not found' using errcode = 'P0002';
  end if;
  if v_edition.status = 'open' then
    raise exception 'Close the edition before permanent deletion'
      using errcode = '22023';
  end if;
  if p_confirmation is distinct from v_edition.name then
    raise exception 'Edition name confirmation does not match'
      using errcode = '22023';
  end if;

  insert into public.deleted_edition_years (year, last_registration_number, deleted_by)
  values (
    v_edition.year,
    coalesce((
      select last_number from public.edition_counters
      where edition_id = v_edition.id
    ), 0),
    auth.uid()
  );

  delete from public.payment_audit
  where registration_id in (
    select id from public.registrations where edition_id = v_edition.id
  );
  delete from public.registrations where edition_id = v_edition.id;
  get diagnostics v_deleted_registrations = row_count;
  delete from public.categories where edition_id = v_edition.id;
  delete from public.edition_public_settings where edition_id = v_edition.id;
  delete from public.edition_counters where edition_id = v_edition.id;
  delete from public.editions where id = v_edition.id;

  return v_deleted_registrations;
end;
$$;

revoke all on function public.delete_edition_and_registrations(uuid, text)
  from public, anon;
grant execute on function public.delete_edition_and_registrations(uuid, text)
  to authenticated;

commit;
