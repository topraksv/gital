-- Sharing (SPEC 1.2–1.6, 1.9, 7.7–7.8): a list, or a wish collection, has
-- members, and every policy that asked "is this the owner's list" now asks
-- "is this one of my lists" through the two functions 0003 left for it.
--
-- A member row is made only here, on the server: by the owner's first
-- invitation (their own row) and by an invitation accepted. So its id is the
-- server's, and no device can write itself into a list. What a device writes
-- back is guarded below: a member may change their own name and `seen_at`, or
-- leave; the owner may change a role or remove a member. Nobody changes the
-- owner's row, and nobody but an invitation brings a removed member back.

begin;

create table public.list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  role text not null check (role in ('owner', 'editor', 'viewer')),
  name text not null default '' check (char_length(name) <= 60),
  seen_at timestamptz,
  unique (list_id, user_id)
);

-- Who shopped or added a row (SPEC 1.5). Shown, never trusted: a member could
-- write another's id, and all it would change is two letters on a row.
alter table public.items add column added_by uuid, add column checked_by uuid;

-- Hashed, so the table never holds a token that works; one use, then gone.
create table public.list_invites (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  list_id uuid not null references public.lists (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.list_invites enable row level security;
revoke all on table public.list_invites from anon, authenticated;
grant all on table public.list_invites to service_role;

-- ---------------------------------------------------------------------------
-- Who may read and write a list
-- ---------------------------------------------------------------------------

create or replace function public.is_list_owner(list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = list and l.owner_id = (select auth.uid()));
$$;

create or replace function public.can_read_list(list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = list and l.owner_id = (select auth.uid()))
      or exists (
        select 1 from public.list_members m
         where m.list_id = list and m.user_id = (select auth.uid()) and m.deleted_at is null
      );
$$;

create or replace function public.can_write_list(list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = list and l.owner_id = (select auth.uid()))
      or exists (
        select 1 from public.list_members m
         where m.list_id = list and m.user_id = (select auth.uid()) and m.deleted_at is null and m.role = 'editor'
      );
$$;

drop policy lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated
  using (public.can_read_list(id));

-- The owner is who made the list, for ever; and only the owner deletes it.
-- An editor's delete keeps the row live, and the answer brings their device back.
create or replace function public.keep_list_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_id := old.owner_id;
  if old.owner_id is distinct from (select auth.uid()) then
    new.deleted_at := old.deleted_at;
    new.tombstone_version := old.tombstone_version;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

alter table public.list_members enable row level security;
-- A person always sees their own rows, so a device learns it was removed.
create policy list_members_select on public.list_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_read_list(list_id));
create policy list_members_update on public.list_members for update to authenticated
  using (user_id = (select auth.uid()) or public.is_list_owner(list_id))
  with check (user_id = (select auth.uid()) or public.is_list_owner(list_id));

-- What a device's write may change. The invitation functions write as their
-- definer and pass through untouched.
create or replace function public.guard_list_member()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_owner boolean := public.is_list_owner(old.list_id);
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

create trigger guard_list_member before update on public.list_members
  for each row execute function public.guard_list_member();
create trigger set_updated_at before insert or update on public.list_members
  for each row execute function public.set_updated_at();
create index list_members_user on public.list_members (user_id);
create index list_members_pull on public.list_members (updated_at, id);

revoke all on table public.list_members from anon, authenticated;
grant select, update on table public.list_members to authenticated;
grant all on table public.list_members to service_role;

-- ---------------------------------------------------------------------------
-- Invitations (SPEC 1.4)
-- ---------------------------------------------------------------------------

-- The owner's link for one person: a token of 256 random bits, returned once.
create or replace function public.create_list_invite(list uuid, invite_role text, owner_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  token text := pg_catalog.replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if invite_role not in ('editor', 'viewer') then
    raise invalid_parameter_value using message = 'invalid role';
  end if;
  if not exists (select 1 from public.lists l where l.id = list and l.owner_id = me and l.deleted_at is null) then
    raise insufficient_privilege using message = 'not the owner of this list';
  end if;
  insert into public.list_members (list_id, user_id, role, name)
  values (list, me, 'owner', pg_catalog.left(coalesce(owner_name, ''), 60))
  on conflict (list_id, user_id) do nothing;
  delete from public.list_invites where created_by = me and expires_at < now();
  insert into public.list_invites (token_hash, list_id, role, created_by, expires_at)
  values (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex'), list, invite_role, me, now() + interval '7 days');
  return token;
end;
$$;

-- Joining by a link: the list's id, or an error that says why not.
create or replace function public.accept_list_invite(token text, member_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  invite public.list_invites;
begin
  delete from public.list_invites i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(token, ''), 'UTF8')), 'hex')
  returning * into invite;
  if invite is null or invite.expires_at < now()
     or not exists (select 1 from public.lists l where l.id = invite.list_id and l.deleted_at is null) then
    raise invalid_parameter_value using message = 'invite not found';
  end if;
  if exists (select 1 from public.lists l where l.id = invite.list_id and l.owner_id = me) then
    return invite.list_id;
  end if;
  insert into public.list_members (list_id, user_id, role, name)
  values (invite.list_id, me, invite.role, pg_catalog.left(coalesce(member_name, ''), 60))
  on conflict (list_id, user_id) do update
    set role = excluded.role, name = excluded.name, deleted_at = null;
  return invite.list_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The change probe, with the members' head
-- ---------------------------------------------------------------------------

create or replace function public.sync_cursors()
returns table (table_name text, max_updated_at timestamptz, max_id uuid)
language sql
security invoker
stable
set search_path = ''
as $$
  select 'lists'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.lists h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'list_members'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.list_members h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'shops'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.shops h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'items'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.items h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'wishes'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.wishes h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'wish_links'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.wish_links h order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'products'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.products h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'sets'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.sets h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'set_items'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.set_items h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'pantry_items'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.pantry_items h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'pantry_moves'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.pantry_moves h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'settings'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.settings h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true;
$$;

revoke all on function public.is_list_owner(uuid) from public, anon;
revoke all on function public.guard_list_member() from public, anon, authenticated;
revoke all on function public.create_list_invite(uuid, text, text) from public, anon;
revoke all on function public.accept_list_invite(text, text) from public, anon;
grant execute on function public.is_list_owner(uuid) to authenticated;
grant execute on function public.create_list_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_list_invite(text, text) to authenticated;

commit;
