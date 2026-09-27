-- A finished shop keeps the photo of its receipt (the owner asked
-- 2026-09-27). The picture travels as an item's does, so whoever can read the
-- shop can read the photo it names: can_see_photo learns the third table.
alter table public.shops add column photo_id uuid;
create index shops_photo_id on public.shops (photo_id) where photo_id is not null;

create or replace function public.can_see_photo(photo uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select photo is not null and (
    exists (select 1 from public.items i where i.photo_id = photo)
    or exists (select 1 from public.wishes w where w.photo_id = photo)
    or exists (select 1 from public.shops s where s.photo_id = photo)
  );
$$;
