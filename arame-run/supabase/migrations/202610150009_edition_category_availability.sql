create or replace function public.set_edition_available_categories(
  p_edition_id uuid,
  p_category_ids uuid[]
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

  if p_category_ids is null then
    raise exception 'Category selection is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.editions where id = p_edition_id) then
    raise exception 'Edition not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_category_ids) as selected(id)
    left join public.categories as c
      on c.id = selected.id and c.edition_id = p_edition_id
    where c.id is null
  ) then
    raise exception 'A selected category does not belong to this edition' using errcode = '22023';
  end if;

  update public.categories as c
  set is_active = c.id = any(p_category_ids)
  where c.edition_id = p_edition_id;
end;
$$;

revoke all on function public.set_edition_available_categories(uuid, uuid[]) from public, anon;
grant execute on function public.set_edition_available_categories(uuid, uuid[]) to authenticated;
