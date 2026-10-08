-- Two things devil round 2026-10-07-2 proved one account could do to
-- another, closed where only the server can close them.
--
-- 1. A second owner. A list's owner could send `role = 'owner'` on a member's
-- row — the app never offers it — and the guard, which keeps an owner row's
-- role and removal for every caller, then held that member in the list for
-- good: they could not leave and the owner could not remove them. Only the
-- invitation functions, which write as their definer, give a role; a device
-- may change one between editor and viewer.
create or replace function public.guard_list_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_owner boolean := private.is_list_owner(old.list_id);
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.list_id := old.list_id;
  new.user_id := old.user_id;
  if old.role = 'owner' then
    -- The owner neither leaves nor is demoted: a list without one has nobody to delete it.
    new.role := 'owner';
    new.deleted_at := old.deleted_at;
    new.tombstone_version := old.tombstone_version;
  elsif not is_owner or new.role = 'owner' then
    new.role := old.role;
  end if;
  if old.deleted_at is not null then
    -- Back in only by a new invitation.
    new.deleted_at := old.deleted_at;
    new.tombstone_version := old.tombstone_version;
  end if;
  if old.user_id <> (select auth.uid()) then
    new.name := old.name;
    new.seen_at := old.seen_at;
  end if;
  return new;
end;
$$;

-- A second owner named before this migration goes back to editing: the list's
-- `owner_id` says whose it is, and no path but that bug gave anyone else the role.
update public.list_members m
set role = 'editor'
from public.lists l
where l.id = m.list_id and m.role = 'owner' and m.user_id <> l.owner_id;

-- 2. A photo moved onto an id someone else's row names. Migration 14 put
-- `can_place_photo` on insert, but Storage authorises a move as an update of
-- the object's name, and the update policy checked only the uploader. The
-- app's own upload upserts its photo, so it passes this check through insert
-- already and loses nothing.
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid())::text)
  with check (
    bucket_id = 'photos'
    and owner_id = (select auth.uid())::text
    and private.can_place_photo(public.photo_of_object(name))
  );
