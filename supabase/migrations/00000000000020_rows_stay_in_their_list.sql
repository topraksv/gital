-- A row stays in the list it was made in. The update policies ask only that
-- the caller can write both the old list and the new, so an editor of a shared
-- list could send `list_id` of their own list and carry a wish, an item or a
-- shop off: the owner's devices, which cannot read that list, kept it as live,
-- and their next edit of a wish met an id in a list they cannot write and was
-- set aside for good (devil round 2026-11-03-1). The app never moves a row in
-- place — a move deletes it here and writes a new one there — so pinning the
-- column costs nothing a device sends.
create or replace function public.keep_row_list()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' then
    new.list_id := old.list_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_row_list() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['shops', 'items', 'wishes', 'wish_links'] loop
    execute format(
      'create trigger keep_row_list before update of list_id on public.%I for each row execute function public.keep_row_list()',
      t);
  end loop;
end;
$$;
