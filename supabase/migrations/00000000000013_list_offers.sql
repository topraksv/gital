-- Offers: a list's owner asks someone in the app, with no link (the owner,
-- 2026-10-01). Only to a person they already share a live list with, so no
-- account is ever looked up by anything else; an offer waits until answered,
-- and one declined is deleted, leaving no record.
--
-- An offer is a `list_invites` row addressed to a person instead of hashed
-- into a link: exactly one of `token_hash` and `invitee` is set. A link is
-- found only by its hash and an offer has none, so no link reaches an offer,
-- and `peek_list_invite`, `create_list_invite` and the 1.6.0 client stay as
-- they are. Both ways in admit a person through one function.

begin;

-- ---------------------------------------------------------------------------
-- A row is a link or an offer
-- ---------------------------------------------------------------------------

-- A volatile default fills every existing row with its own id.
alter table public.list_invites add column id uuid not null default gen_random_uuid();
alter table public.list_invites drop constraint list_invites_pkey;
alter table public.list_invites add constraint list_invites_pkey primary key (id);
alter table public.list_invites alter column token_hash drop not null;
alter table public.list_invites add constraint list_invites_token_hash_key unique (token_hash);
alter table public.list_invites add column invitee uuid references auth.users (id) on delete cascade;
alter table public.list_invites add constraint list_invites_link_or_offer
  check ((token_hash is null) <> (invitee is null));
-- One offer a person a list. Invitee first: the account's delete cascades on
-- it and every read asks "offers to me"; `list_invites_list_id_idx` (migration
-- 11) already serves the list's side.
create unique index list_invites_offer on public.list_invites (invitee, list_id) where invitee is not null;

-- ---------------------------------------------------------------------------
-- Admission, shared by a link and an offer
-- ---------------------------------------------------------------------------

-- Migration 12's `accept_list_invite` from the owner check on. Being let in
-- answers any offer to the same list, so none is ever addressed to a member.
create or replace function private.admit(list uuid, member_role text, member_name text, pantry jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  delete from public.list_invites i where i.list_id = list and i.invitee = me;
  if exists (select 1 from public.lists l where l.id = list and l.owner_id = me) then
    return;
  end if;
  if exists (select 1 from public.lists l where l.id = list and l.kind = 'pantry')
     and not private.join_household(list, pantry) then
    return;
  end if;
  insert into public.list_members (list_id, user_id, role, name)
  values (list, me, member_role, pg_catalog.left(coalesce(member_name, ''), 60))
  on conflict (list_id, user_id) do update
    set role = excluded.role, name = excluded.name, deleted_at = null;
end;
$$;

-- Migration 12's, its admission moved out. Same signature, so 1.6.0 calls it
-- unchanged and PostgREST still has one to choose.
create or replace function public.accept_list_invite(token text, member_name text, pantry jsonb default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  invite public.list_invites;
begin
  delete from public.list_invites i
   where i.token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(token, ''), 'UTF8')), 'hex')
  returning * into invite;
  if invite is null or invite.expires_at < now()
     or not exists (select 1 from public.lists l where l.id = invite.list_id and l.deleted_at is null) then
    raise invalid_parameter_value using message = 'invite not found';
  end if;
  perform private.admit(invite.list_id, invite.role, member_name, pantry);
  return invite.list_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------

-- The owner offers `list` to `person` as `role`, or withdraws with no role.
-- Offering again changes the role. A Kiler offer is `create_list_invite`'s:
-- the same lock and refusal, editors only, and the household made on the
-- first. Whether the person can join a household is asked when they answer.
-- The two refusals a person's screen can meet have codes of their own (ZK004
-- one already in, whose row has not synced yet; ZK005 one no longer sharing),
-- so the app says which instead of a link's "used or expired".
-- An offer has no expiry; `infinity` keeps `expires_at` and every comparison
-- on it as they were.
create or replace function public.offer_list(list uuid, person uuid, role text, owner_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if offer_list.role is null then
    delete from public.list_invites i
     using public.lists l
     where i.list_id = list and i.invitee = person and l.id = i.list_id and l.owner_id = me;
    return;
  end if;
  if offer_list.role not in ('editor', 'viewer') then
    raise invalid_parameter_value using message = 'invalid role';
  end if;
  if list = me then
    perform pg_catalog.pg_advisory_xact_lock(12);
    if private.my_pantry() <> me then
      raise exception 'in another household' using errcode = 'ZK001';
    end if;
    if offer_list.role <> 'editor' then
      raise invalid_parameter_value using message = 'a household has no viewers';
    end if;
    insert into public.lists (id, owner_id, name, kind) values (me, me, 'Kiler', 'pantry')
    on conflict (id) do nothing;
  end if;
  if not exists (select 1 from public.lists l where l.id = list and l.owner_id = me and l.deleted_at is null) then
    raise insufficient_privilege using message = 'not the owner of this list';
  end if;
  if person is null or person = me then
    raise invalid_parameter_value using message = 'an offer is to someone else';
  end if;
  if exists (select 1 from public.list_members m where m.list_id = list and m.user_id = person and m.deleted_at is null) then
    raise exception 'already in this list' using errcode = 'ZK004';
  end if;
  if not exists (
    select 1
      from public.list_members theirs
      join public.list_members mine on mine.list_id = theirs.list_id and mine.user_id = me and mine.deleted_at is null
      join public.lists l on l.id = theirs.list_id and l.deleted_at is null
     where theirs.user_id = person and theirs.deleted_at is null
  ) then
    raise exception 'shares no list with you' using errcode = 'ZK005';
  end if;
  insert into public.list_members (list_id, user_id, role, name)
  values (list, me, 'owner', pg_catalog.left(coalesce(owner_name, ''), 60))
  on conflict (list_id, user_id) do nothing;
  insert into public.list_invites (list_id, role, created_by, expires_at, invitee)
  values (list, offer_list.role, me, 'infinity', person)
  on conflict (list_id, invitee) where invitee is not null do update set role = excluded.role;
end;
$$;

-- The offers made to this person and by them, on lists still live. The
-- sender's name is the one the owner gave the list's members; matched on
-- `owner_id`, so a second row with role `owner` cannot double an offer.
create or replace function public.list_offers()
returns table (list_id uuid, list_name text, kind text, role text, from_name text, to_user uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select i.list_id, l.name, l.kind, i.role, coalesce(o.name, ''), i.invitee
    from public.list_invites i
    join public.lists l on l.id = i.list_id and l.deleted_at is null
    left join public.list_members o on o.list_id = l.id and o.user_id = l.owner_id
   where i.invitee is not null
     and (i.invitee = (select auth.uid()) or i.created_by = (select auth.uid()))
   order by i.created_at, i.id;
$$;

-- Accept, and the list's id comes back; decline, and the offer is deleted.
-- A refusal (the list gone, ZK001–ZK003) rolls back the whole call, so the
-- offer waits to be answered again.
create or replace function public.answer_offer(list uuid, accept boolean, member_name text, pantry jsonb default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  offered public.list_invites;
begin
  if accept is null then
    raise invalid_parameter_value using message = 'accept or decline';
  end if;
  delete from public.list_invites i
   where i.list_id = list and i.invitee = me
  returning * into offered;
  if not found then
    raise invalid_parameter_value using message = 'offer not found';
  end if;
  if not accept then
    return null;
  end if;
  if not exists (select 1 from public.lists l where l.id = list and l.deleted_at is null) then
    raise invalid_parameter_value using message = 'offer not found';
  end if;
  perform private.admit(list, offered.role, member_name, pantry);
  return list;
end;
$$;

-- ---------------------------------------------------------------------------
-- The change probe says when the offers to a person change
-- ---------------------------------------------------------------------------

-- A hash of the offers to this person, on live lists, with what the offer
-- shows: an offer made, re-made at another role, withdrawn, answered or left
-- behind by a deleted list each changes it, and so does renaming the list or
-- the owner's name in it, which the waiting card would otherwise keep. Null
-- when none waits. As the function's owner, since nobody signed in reads
-- `list_invites`.
create or replace function private.my_offers()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.md5(pg_catalog.string_agg(
           pg_catalog.concat_ws(':', i.id, i.role, l.name, o.name), ',' order by i.id))::uuid
    from public.list_invites i
    join public.lists l on l.id = i.list_id and l.deleted_at is null
    left join public.list_members o on o.list_id = l.id and o.user_id = l.owner_id
   where i.invitee = (select auth.uid());
$$;

-- Migration 12's, and a row `offers`. A 1.6.0 client skips a row with an id
-- and no time, and keeps one with neither as a table it never asks about.
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
  select 'pantry_home'::text, null::timestamptz, (select private.my_pantry())
  union all
  select 'offers'::text, null::timestamptz, (select private.my_offers());
$$;

-- `private` has no default privileges, so a new function there is anyone's
-- until revoked; `public`'s withhold execute (migration 3) until granted.
revoke all on function private.admit(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.my_offers() from public, anon;
grant execute on function private.my_offers() to authenticated;
revoke all on function public.offer_list(uuid, uuid, text, text) from public, anon;
revoke all on function public.list_offers() from public, anon;
revoke all on function public.answer_offer(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.offer_list(uuid, uuid, text, text) to authenticated;
grant execute on function public.list_offers() to authenticated;
grant execute on function public.answer_offer(uuid, boolean, text, jsonb) to authenticated;

commit;
