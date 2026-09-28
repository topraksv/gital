-- The helpers RLS calls leave the API schema (Supabase's security advisor,
-- 2026-09-28): in `public` PostgREST serves each SECURITY DEFINER one as an RPC,
-- so any signed-in account could ask whether a list id exists and whose it is.
-- A policy holds its function by OID, so moving the schema changes no policy;
-- the grants move with the function. `authenticated` keeps USAGE on `private`
-- because a policy runs as the requesting role; the API serves only `public`
-- and `graphql_public` (`config.toml`), so nothing there is reachable by URL.
-- `own_photo_objects` stays: the app calls it (`src/sync/photos.ts`).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.can_read_list(uuid) set schema private;
alter function public.can_write_list(uuid) set schema private;
alter function public.is_list_owner(uuid) set schema private;
alter function public.is_member_row(uuid) set schema private;

-- The one body that names a helper: a function body is text, bound at call
-- time, so it follows the move by hand. Otherwise as in migration 5.
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
  elsif not is_owner then
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

-- Unindexed foreign keys (performance advisor): a list's or an account's
-- delete scans the invites without them.
create index list_invites_list_id_idx on public.list_invites (list_id);
create index list_invites_created_by_idx on public.list_invites (created_by);
