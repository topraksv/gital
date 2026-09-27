-- Sync (SPEC 10.2): the Postgres side of every table the device writes, in
-- Helix's conventions, and the bucket its photos go to.
--
-- A row is scoped one of two ways (`docs/ARCHITECTURE.md`, "Tables"):
--
--   - by its list: `list_id`, and the list decides who reads and writes it.
--     Today that is the list's owner; sharing adds members by replacing
--     `can_read_list` and `can_write_list`, and no policy here changes.
--   - by its person: `user_id`, part of the primary key, because a personal
--     row's id is a hash of what it names ("süt"), and two people name the
--     same things. The device holds one account and keeps `id` alone.
--
-- `updated_at` is the server's clock and a delete generation outranks it, as
-- in Helix: a device that never saw a delete cannot undo it by writing later.
-- Deletes are tombstones; the client holds no DELETE privilege.

begin;

-- Helix's trigger (its migration 12), unchanged.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null and new.tombstone_version = 0 then
      new.tombstone_version := 1;
    end if;
  else
    -- An older client did not observe the latest delete/undo generation. Keep
    -- the server row and return it through PostgREST so the client converges.
    if new.tombstone_version < old.tombstone_version then
      return old;
    end if;

    if old.deleted_at is null and new.deleted_at is not null then
      if new.tombstone_version not in (old.tombstone_version, old.tombstone_version + 1) then
        raise check_violation using message = 'invalid tombstone generation';
      end if;
      new.tombstone_version := old.tombstone_version + 1;
    elsif new.tombstone_version <> old.tombstone_version then
      raise check_violation using message = 'invalid tombstone generation';
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists and what is on them
-- ---------------------------------------------------------------------------

create table public.lists (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  color text check (char_length(color) <= 40),
  icon text check (char_length(icon) <= 40),
  kind text not null default 'shop' check (kind in ('shop', 'wish')),
  pantry boolean not null default true
);

-- The owner is who made the list, for ever: an editor's write cannot take it.
create or replace function public.keep_list_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_id := old.owner_id;
  return new;
end;
$$;

create trigger keep_list_owner before update on public.lists
  for each row execute function public.keep_list_owner();

-- Whether the caller may read, and may write, a list's rows. Definer rights,
-- so a policy on a child table can ask without the caller reading `lists`
-- through its own policy. Stable: one answer per list per statement.
create or replace function public.can_read_list(list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = list and l.owner_id = (select auth.uid()));
$$;

create or replace function public.can_write_list(list uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.lists l where l.id = list and l.owner_id = (select auth.uid()));
$$;

create table public.shops (
  id uuid primary key,
  list_id uuid not null references public.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  number integer not null check (number >= 1),
  finished_at timestamptz not null,
  total_minor bigint check (total_minor between 0 and 100000000000)
);

create table public.items (
  id uuid primary key,
  list_id uuid not null references public.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  quantity_milli bigint check (quantity_milli between 0 and 1000000000000),
  unit text check (char_length(unit) <= 40),
  sort_order bigint not null default 0,
  checked_at timestamptz,
  note text check (char_length(note) <= 1000),
  urgent boolean not null default false,
  not_found boolean not null default false,
  bought_instead text check (char_length(bought_instead) <= 200),
  price_minor bigint check (price_minor between 0 and 100000000000),
  shop_id uuid,
  photo_id uuid
);

create table public.wishes (
  id uuid primary key,
  list_id uuid not null references public.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  note text check (char_length(note) <= 1000),
  priority smallint not null default 1 check (priority between 0 and 2),
  estimate_minor bigint check (estimate_minor between 0 and 100000000000),
  bought_at timestamptz,
  photo_id uuid,
  due_on date
);

create table public.wish_links (
  id uuid primary key,
  list_id uuid not null references public.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  wish_id uuid not null,
  url text not null check (char_length(url) between 1 and 2048),
  price_minor bigint check (price_minor between 0 and 100000000000)
);

-- ---------------------------------------------------------------------------
-- A person's own rows
-- ---------------------------------------------------------------------------

create table public.products (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  starred boolean not null default false,
  aisle text check (char_length(aisle) <= 40),
  primary key (user_id, id)
);

create table public.sets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  primary key (user_id, id)
);

create table public.set_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  set_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  quantity_milli bigint check (quantity_milli between 0 and 1000000000000),
  unit text check (char_length(unit) <= 40),
  note text check (char_length(note) <= 1000),
  position integer not null,
  primary key (user_id, id)
);

create table public.pantry_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  name text not null check (char_length(name) between 1 and 200),
  -- No reference: the list may be one the person has since left.
  list_id uuid,
  expires_on date,
  primary key (user_id, id)
);

create table public.pantry_moves (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  pantry_item_id uuid not null,
  -- Negative is what was used (SPEC 12.8).
  quantity_milli bigint not null check (quantity_milli between -1000000000000 and 1000000000000),
  unit text not null check (char_length(unit) <= 40),
  primary key (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Policies, triggers, privileges and the pull's indexes
-- ---------------------------------------------------------------------------

alter table public.lists enable row level security;
create policy lists_select on public.lists for select to authenticated
  using (owner_id = (select auth.uid()));
create policy lists_insert on public.lists for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy lists_update on public.lists for update to authenticated
  using (public.can_write_list(id))
  with check (public.can_write_list(id));

do $$
declare
  t text;
begin
  foreach t in array array['shops', 'items', 'wishes', 'wish_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.can_read_list(list_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_write_list(list_id))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_write_list(list_id)) with check (public.can_write_list(list_id))',
      t || '_update', t);
    execute format('create index %I on public.%I (list_id)', t || '_list_id', t);
    execute format('create index %I on public.%I (updated_at, id)', t || '_pull', t);
  end loop;

  foreach t in array array['products', 'sets', 'set_items', 'pantry_items', 'pantry_moves'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update', t);
    execute format('create index %I on public.%I (user_id, updated_at, id)', t || '_pull', t);
  end loop;

  foreach t in array array[
    'lists', 'shops', 'items', 'wishes', 'wish_links',
    'products', 'sets', 'set_items', 'pantry_items', 'pantry_moves'
  ] loop
    execute format(
      'create trigger set_updated_at before insert or update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create index lists_owner_id on public.lists (owner_id);
create index lists_pull on public.lists (updated_at, id);
-- What a photo read asks: which rows name this photo.
create index items_photo_id on public.items (photo_id) where photo_id is not null;
create index wishes_photo_id on public.wishes (photo_id) where photo_id is not null;

-- ---------------------------------------------------------------------------
-- The change probe (Helix's migration 32): one keyset head per table, so a
-- sync pulls only the tables that moved. Invoker rights, so it sees what the
-- caller's policies let it see and nothing more.
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
    left join lateral (select h.updated_at, h.id from public.pantry_moves h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true;
$$;

-- ---------------------------------------------------------------------------
-- Photos (SPEC 8.2): `<photo id>/full.jpg` and `<photo id>/thumb.jpg`.
--
-- The path carries no list and no person, because a photo moves with its
-- item from list to list. So the read is decided by the rows: a photo is
-- readable by whoever can read a row that names it, and by its uploader.
-- Only the uploader overwrites or removes it. Private, JPEG only, 2 MB,
-- which is ten times what the app's 1024-pixel photo weighs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The photo an object name holds, or null for a name the app never makes.
create or replace function public.photo_of_object(name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(full|thumb)\.jpg$'
    then pg_catalog.split_part(name, '/', 1)::uuid
  end;
$$;

-- Invoker rights on purpose: the caller's own policies on items and wishes
-- decide which rows it can see, so this can never widen them.
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
  );
$$;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (owner_id = (select auth.uid())::text or public.can_see_photo(public.photo_of_object(name)))
  );

drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.photo_of_object(name) is not null);

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'photos' and owner_id = (select auth.uid())::text and public.photo_of_object(name) is not null);

drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid())::text);

-- What a deleted account's device removes through the Storage API first:
-- Storage refuses a delete against its tables, and nothing cascades to it.
create or replace function public.own_photo_objects()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'photos' and o.owner_id = (select auth.uid())::text;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.keep_list_owner() from public, anon, authenticated;
revoke all on function public.can_read_list(uuid) from public, anon;
revoke all on function public.can_write_list(uuid) from public, anon;
revoke all on function public.photo_of_object(text) from public, anon;
revoke all on function public.can_see_photo(uuid) from public, anon;
revoke all on function public.sync_cursors() from public, anon, service_role;
revoke all on function public.own_photo_objects() from public, anon, service_role;
grant execute on function public.can_read_list(uuid) to authenticated;
grant execute on function public.can_write_list(uuid) to authenticated;
grant execute on function public.photo_of_object(text) to authenticated;
grant execute on function public.can_see_photo(uuid) to authenticated;
grant execute on function public.sync_cursors() to authenticated;
grant execute on function public.own_photo_objects() to authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

commit;
