-- What the backlog decided on 2026-10-09, where only the server can hold it.

-- 1. A photo budget per account. Each object was capped at 2 MB and the bucket
-- at the plan's 1 GB, so one account could fill it for everyone. Storage
-- authorises an upload before it has the bytes, so no policy can weigh one;
-- it then writes the row as itself with the size, and a refusal there leaves
-- no file behind (measured on the local stack, 2026-10-09). 100 MB is about
-- 450 of the app's photos, each with its thumbnail. Refused as a policy
-- refusal is, so the device passes the photo over and its row goes up
-- without it (`src/sync/photos.ts`). Rejected: a captcha on sign-up, which
-- slows new accounts but caps none.
create or replace function private.keep_photo_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id = 'photos' and new.owner_id is not null
     and coalesce((new.metadata ->> 'size')::bigint, 0) + coalesce((
       select sum((o.metadata ->> 'size')::bigint) from storage.objects o
        where o.bucket_id = 'photos' and o.owner_id = new.owner_id and o.id <> new.id
     ), 0) > 104857600 then
    raise exception 'photo budget' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.keep_photo_budget() from public, anon, authenticated;

create trigger keep_photo_budget before insert or update on storage.objects
  for each row execute function private.keep_photo_budget();

-- 2. A list's channel carries the server's word only. Presence outlived the
-- decision to read who is shopping from ticks (2026-10-01), and a member could
-- still speak there. Measured on the local stack: a private channel with only
-- a read policy joins and hears its broadcasts.
drop policy list_channel_presence on realtime.messages;
drop policy list_channel_hear on realtime.messages;
create policy list_channel_hear on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and private.can_read_list(public.list_of_topic((select realtime.topic())))
  );

-- 3. One nudge per list per statement. A push of 200 rows wrote 200 messages
-- and each member heard 200 nudges; a transition table names each list once.
-- A Kiler nobody shares has no channel anyone hears.
create or replace function public.nudge_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := case when tg_table_name = 'lists' then 'id' when tg_table_name like 'pantry%' then 'user_id' else 'list_id' end;
  list uuid;
begin
  for list in select distinct (pg_catalog.to_jsonb(r) ->> key)::uuid from new_rows r loop
    if tg_table_name not like 'pantry%' or exists (select 1 from public.lists l where l.id = list and l.kind = 'pantry') then
      perform realtime.send(pg_catalog.jsonb_build_object('by', auth.uid()), 'moved', 'list:' || list, true);
    end if;
  end loop;
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['lists', 'list_members', 'shops', 'items', 'wishes', 'wish_links', 'pantry_items', 'pantry_moves'] loop
    execute pg_catalog.format('drop trigger if exists nudge_list on public.%I', t);
    execute pg_catalog.format('drop trigger if exists nudge_pantry on public.%I', t);
    -- A transition table takes one event a trigger.
    execute pg_catalog.format(
      'create trigger nudge_list_insert after insert on public.%I referencing new table as new_rows
         for each statement execute function public.nudge_list()', t);
    execute pg_catalog.format(
      'create trigger nudge_list_update after update on public.%I referencing new table as new_rows
         for each statement execute function public.nudge_list()', t);
  end loop;
end;
$$;

drop function public.nudge_pantry();

-- 4. A removed member hears it. Their device left the list's channel when the
-- list stopped being theirs to read, so the removal waited for the poll. Each
-- person hears their own channel, `user:<id>`, and is told there when their
-- place in a list changes.
create policy user_channel_hear on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'user:' || (select auth.uid())::text
  );

create or replace function private.tell_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid;
  list uuid;
begin
  for person, list in
    select n.user_id, n.list_id from new_rows n join old_rows o on o.id = n.id
     where n.deleted_at is distinct from o.deleted_at or n.role is distinct from o.role
  loop
    perform realtime.send(pg_catalog.jsonb_build_object('by', auth.uid(), 'list', list), 'moved', 'user:' || person, true);
  end loop;
  return null;
end;
$$;

revoke all on function private.tell_member() from public, anon, authenticated;

create trigger tell_member after update on public.list_members
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.tell_member();

-- 5. A shop says it was cleared rather than undone. Resetting Geçmiş
-- tombstones a shared list's shops, and each member's device read that as an
-- undo and took back what the shop had brought their Kiler.
alter table public.shops add column cleared_at timestamptz;

-- 6. A wish link says its page was read, whatever was found, so "unread" is no
-- longer guessed from a wish still carrying its shop's name.
alter table public.wish_links add column read_at timestamptz;

-- 7. Sharing opens one way. `create_list_invite` and `offer_list` each wrote
-- the household lock, the Kiler's row and the owner's member row.
create or replace function private.open_to_share(list uuid, member_role text, owner_name text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if member_role not in ('editor', 'viewer') then
    raise invalid_parameter_value using message = 'invalid role';
  end if;
  if list = me then
    perform pg_catalog.pg_advisory_xact_lock(12);
    if private.my_pantry() <> me then
      raise exception 'in another household' using errcode = 'ZK001';
    end if;
    if member_role <> 'editor' then
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
end;
$$;

revoke all on function private.open_to_share(uuid, text, text) from public, anon, authenticated;

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
  perform private.open_to_share(list, invite_role, owner_name);
  delete from public.list_invites where created_by = me and expires_at < now();
  insert into public.list_invites (token_hash, list_id, role, created_by, expires_at)
  values (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex'), list, invite_role, me, now() + interval '7 days');
  return token;
end;
$$;

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
  perform private.open_to_share(list, offer_list.role, owner_name);
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
  insert into public.list_invites (list_id, role, created_by, expires_at, invitee)
  values (list, offer_list.role, me, 'infinity', person)
  on conflict (list_id, invitee) where invitee is not null do update set role = excluded.role;
end;
$$;

-- 8. The photos no row names any more: replaced, undone, or taken with a row
-- that went. Its uploader's device removes them through Storage, which alone
-- removes a file. A month old at least, since a photo goes up before the row
-- naming it and a device may hold that row unsent; one held longer arrives
-- without it, as a photo Storage refused does.
create or replace function public.unnamed_photos()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'photos' and o.owner_id = (select auth.uid())::text
     and o.created_at < now() - interval '30 days'
     and not exists (select 1 from public.items i where i.photo_id = public.photo_of_object(o.name) and i.deleted_at is null)
     and not exists (select 1 from public.wishes w where w.photo_id = public.photo_of_object(o.name) and w.deleted_at is null)
     and not exists (select 1 from public.shops s where s.photo_id = public.photo_of_object(o.name) and s.deleted_at is null);
$$;

revoke all on function public.unnamed_photos() from public, anon;
grant execute on function public.unnamed_photos() to authenticated;

-- 9. A report from someone signed out. Sign-up and sign-in say "tell us in
-- Geri bildirim" when mail fails, and that screen needed an account. Signed
-- out there is no one to count against, so all such reports share one bound:
-- ten a day reach the owner, and a flood spends only those ten, never an
-- account's own. The function takes no picture from them and wants an
-- address to answer.
alter table public.feedback_reports alter column user_id drop not null;

create or replace function public.record_signed_out_feedback_send()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One at a time, so two in flight cannot both read nine.
  perform pg_catalog.pg_advisory_xact_lock(13);
  delete from public.feedback_reports
   where user_id is null and created_at < pg_catalog.now() - interval '1 day';
  if (select count(*) from public.feedback_reports where user_id is null) >= 10 then
    return false;
  end if;
  insert into public.feedback_reports (user_id) values (null);
  return true;
end $$;

revoke all on function public.record_signed_out_feedback_send() from public, authenticated;
grant execute on function public.record_signed_out_feedback_send() to anon;
