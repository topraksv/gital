-- One household Kiler (SPEC 12.2, 12.13; `docs/ARCHITECTURE.md`, 2026-10-01).
--
-- A household is a list of kind `pantry` whose id is its owner's user id, so
-- members, invitations, leaving, removal and the live channel are migration
-- 5's and 6's as they stand. A pantry row's `user_id` now says whose Kiler it
-- is in: the person's own, or the household they joined. Outside a household
-- those are the same id, and nothing an older client sends changes meaning.
--
-- The server decides which Kiler a person is in (`private.my_pantry()`) and
-- tells the device through the change probe; the device stamps its rows with
-- the Kiler it holds, and a row stamped with another is refused, never moved:
-- a pantry row's id is its product's name, so a write sent into a Kiler it was
-- not made in would land on someone else's product of that name.

begin;

-- ---------------------------------------------------------------------------
-- The household's list, which only the server makes
-- ---------------------------------------------------------------------------

alter table public.lists drop constraint lists_kind_check;
alter table public.lists add constraint lists_kind_check check (kind in ('shop', 'wish', 'pantry'));
alter table public.lists add constraint lists_pantry_is_owners check (kind <> 'pantry' or id = owner_id);

-- Whether an id is an account's: a member sees others' ids in `list_members`,
-- and a list made with one would take that person's household before they do.
create or replace function private.is_account(person uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = person);
$$;

drop policy lists_insert on public.lists;
create policy lists_insert on public.lists for insert to authenticated
  with check (owner_id = (select auth.uid()) and kind <> 'pantry' and not private.is_account(id));

-- Migration 5's, keeping the kind too: an editor's write cannot turn the
-- household into a shopping list and so dissolve it.
create or replace function public.keep_list_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_id := old.owner_id;
  new.kind := old.kind;
  if old.owner_id is distinct from (select auth.uid()) then
    new.deleted_at := old.deleted_at;
    new.tombstone_version := old.tombstone_version;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which Kiler a person is in
-- ---------------------------------------------------------------------------

-- The household the person joined, else their own. Ordered, so that should
-- two joins ever both land, every request still reads the same one.
create or replace function private.my_pantry()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.list_id
       from public.list_members m
       join public.lists l on l.id = m.list_id
      where m.user_id = (select auth.uid()) and m.role <> 'owner' and m.deleted_at is null
        and l.kind = 'pantry' and l.deleted_at is null
      order by m.created_at, m.list_id
      limit 1),
    (select auth.uid())
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array['pantry_items', 'pantry_moves'] loop
    execute format('drop policy %I on public.%I', t || '_select', t);
    execute format('drop policy %I on public.%I', t || '_insert', t);
    execute format('drop policy %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select private.my_pantry()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select private.my_pantry()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select private.my_pantry())) with check (user_id = (select private.my_pantry()))',
      t || '_update', t);
  end loop;
end $$;

-- Migration 5's probe, its Kiler the household's, and one row more naming
-- that Kiler. A client before 1.6.0 skips a row with an id and no time.
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
    left join lateral (select h.updated_at, h.id from public.pantry_items h where h.user_id = (select private.my_pantry()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'pantry_moves'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.pantry_moves h where h.user_id = (select private.my_pantry()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'settings'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.settings h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'pantry_home'::text, null::timestamptz, (select private.my_pantry());
$$;

-- ---------------------------------------------------------------------------
-- Invitations into a Kiler
-- ---------------------------------------------------------------------------

-- Migration 5's. A person's own id names their Kiler: its first invitation
-- makes the household, which has editors only, and only someone in no other
-- household invites into their own (the owner, 2026-10-01). Joins and these
-- invitations take one lock, so none of them races another.
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
  if list = me then
    perform pg_catalog.pg_advisory_xact_lock(12);
    if private.my_pantry() <> me then
      raise exception 'in another household' using errcode = 'ZK001';
    end if;
    if invite_role <> 'editor' then
      raise invalid_parameter_value using message = 'a household has no viewers';
    end if;
    insert into public.lists (id, owner_id, name, kind) values (me, me, 'Kiler', 'pantry')
    on conflict (id) do nothing;
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

-- Joining a household: refused while the person is in another or others are
-- in theirs, quietly done when they are already in it. What they chose to
-- bring arrives as the device counted it, one arrival a product; then their
-- own Kiler is emptied, so whoever leaves starts empty (the owner, 2026-10-01).
-- A raise rolls the spent token back with everything else.
create or replace function private.join_household(household uuid, pantry jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  perform pg_catalog.pg_advisory_xact_lock(12);
  if private.my_pantry() = household then
    return false;
  end if;
  if pantry is null then
    raise exception 'this version cannot join a household' using errcode = 'ZK003';
  end if;
  if private.my_pantry() <> me then
    raise exception 'in another household' using errcode = 'ZK001';
  end if;
  if exists (select 1 from public.list_members m where m.list_id = me and m.role <> 'owner' and m.deleted_at is null) then
    raise exception 'others are in this Kiler' using errcode = 'ZK002';
  end if;
  if pg_catalog.jsonb_typeof(pantry) <> 'array' or pg_catalog.jsonb_array_length(pantry) > 1000 then
    raise invalid_parameter_value using message = 'invalid pantry';
  end if;
  delete from public.list_invites where list_id = me;
  insert into public.pantry_items (user_id, id, name, list_id, expires_on)
  select household, b.id, b.name, b.list_id, b.expires_on
    from pg_catalog.jsonb_to_recordset(pantry) as b (id uuid, name text, list_id uuid, expires_on date)
  on conflict (user_id, id) do update set deleted_at = null
    where public.pantry_items.deleted_at is not null;
  insert into public.pantry_moves (user_id, id, pantry_item_id, quantity_milli, unit)
  select household, gen_random_uuid(), b.id, b.quantity_milli, b.unit
    from pg_catalog.jsonb_to_recordset(pantry) as b (id uuid, quantity_milli bigint, unit text)
   where b.quantity_milli > 0;
  update public.pantry_items set deleted_at = now() where user_id = me and deleted_at is null;
  update public.pantry_moves set deleted_at = now() where user_id = me and deleted_at is null;
  return true;
end;
$$;

-- Migration 5's, with the household's choice. Dropped rather than overloaded:
-- with two, PostgREST could not tell which a two-argument call meant.
drop function public.accept_list_invite(text, text);
create function public.accept_list_invite(token text, member_name text, pantry jsonb default null)
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
  if exists (select 1 from public.lists l where l.id = invite.list_id and l.kind = 'pantry')
     and not private.join_household(invite.list_id, pantry) then
    return invite.list_id;
  end if;
  insert into public.list_members (list_id, user_id, role, name)
  values (invite.list_id, me, invite.role, pg_catalog.left(coalesce(member_name, ''), 60))
  on conflict (list_id, user_id) do update
    set role = excluded.role, name = excluded.name, deleted_at = null;
  return invite.list_id;
end;
$$;

-- What a link opens and who sent it, so the page can say so before anyone
-- presses anything. The token is not spent.
create or replace function public.peek_list_invite(token text)
returns table (kind text, name text, inviter text)
language sql
stable
security definer
set search_path = ''
as $$
  select l.kind, l.name, coalesce(o.name, '')
    from public.list_invites i
    join public.lists l on l.id = i.list_id and l.deleted_at is null
    left join public.list_members o on o.list_id = l.id and o.role = 'owner'
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(token, ''), 'UTF8')), 'hex')
     and i.expires_at >= now();
$$;

-- ---------------------------------------------------------------------------
-- The household's channel
-- ---------------------------------------------------------------------------

-- Migration 6's nudge, for a Kiler with a household: one nobody shares has no
-- channel anyone hears.
create or replace function public.nudge_pantry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.lists l where l.id = new.user_id and l.kind = 'pantry') then
    perform realtime.send(pg_catalog.jsonb_build_object('by', auth.uid()), 'moved', 'list:' || new.user_id, true);
  end if;
  return null;
end;
$$;

create trigger nudge_pantry after insert or update on public.pantry_items
  for each row execute function public.nudge_pantry();
create trigger nudge_pantry after insert or update on public.pantry_moves
  for each row execute function public.nudge_pantry();

-- `private` has no default privileges, so a new function there is anyone's
-- until revoked; `public`'s withhold execute (migration 3) until granted.
revoke all on function private.is_account(uuid) from public, anon;
revoke all on function private.my_pantry() from public, anon;
revoke all on function private.join_household(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.is_account(uuid) to authenticated;
grant execute on function private.my_pantry() to authenticated;
revoke all on function public.accept_list_invite(text, text, jsonb) from public, anon;
revoke all on function public.peek_list_invite(text) from public, anon;
revoke all on function public.nudge_pantry() from public, anon, authenticated;
grant execute on function public.accept_list_invite(text, text, jsonb) to authenticated;
grant execute on function public.peek_list_invite(text) to authenticated;

commit;
