create or replace function public.admin_registration_activity(
  p_edition_id uuid,
  p_granularity text
)
returns table (period_start date, registration_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  if p_granularity is null or p_granularity not in ('day', 'month', 'year') then
    raise exception 'Granularity must be day, month, or year' using errcode = '22023';
  end if;

  return query
    select
      pg_catalog.date_trunc(
        p_granularity,
        r.created_at at time zone 'America/Sao_Paulo'
      )::date,
      pg_catalog.count(*)::bigint
    from public.registrations as r
    where r.edition_id = p_edition_id
    group by 1
    order by 1;
end;
$$;

revoke all on function public.admin_registration_activity(uuid, text) from public, anon;
grant execute on function public.admin_registration_activity(uuid, text) to authenticated;
