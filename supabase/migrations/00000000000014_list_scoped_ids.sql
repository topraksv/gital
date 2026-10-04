-- Two things devil round 2026-10-04-1 proved one account could do to another's
-- list, closed where only the server can close them.
--
-- 1. A list's future ids, claimed from outside it. A shop's id is a hash of
-- its list's id and number, an item's of its list's id and name
-- (`src/db/ids.ts`), so both devices mint the same row. Keyed by id alone,
-- anyone who knew a list's id — an ex-member, a household co-member reading
-- `pantry_items.list_id` — could insert those ids into a list of their own,
-- and the owner's real row was refused for good. Keyed by list and id, the
-- same id in another list is another row. The client upserts on
-- `list_id,id` from this migration on; a build before it asks for `id`,
-- which no longer has a constraint, and its pushes fail (42P10, not a
-- refusal: the outbox keeps them) until it updates.
alter table public.shops drop constraint shops_pkey, add primary key (list_id, id);
alter table public.items drop constraint items_pkey, add primary key (list_id, id);

-- 2. A photo placed at an id someone else's row names. Insert took any
-- `<uuid>/full.jpg` not yet in Storage, so a viewer who saw a row before its
-- photo arrived — or after a deleted account's photos were purged — could
-- fill the id with their own picture, and every member would keep it. Now a
-- photo goes only where the uploader may write every list a row naming it is
-- on — so where no row names it yet, too (the app sends a photo before its
-- row). Not "some list": anyone may name any id on a row of a list of their
-- own, which would make the rule theirs to pass. Someone doing that can keep
-- the real uploader out, which costs the photo, never replaces it. Definer,
-- since every naming row counts, those the uploader cannot read included.
create or replace function private.can_place_photo(photo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select photo is not null
    and not exists (select 1 from public.items i where i.photo_id = photo and not private.can_write_list(i.list_id))
    and not exists (select 1 from public.wishes w where w.photo_id = photo and not private.can_write_list(w.list_id))
    and not exists (select 1 from public.shops s where s.photo_id = photo and not private.can_write_list(s.list_id));
$$;
revoke all on function private.can_place_photo(uuid) from public, anon;
grant execute on function private.can_place_photo(uuid) to authenticated;

drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.can_place_photo(public.photo_of_object(name)));
