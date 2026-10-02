-- Offers (migration 13): A offers lists to B, with whom A shares Market, and
-- A's Kiler; C shares nothing with A; D offers B a second household.
-- `sync_rls.sql`'s harness: fixtures as postgres, every assertion as the role
-- a request would carry, and a rollback at the end.
begin;

set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(45);

create function pg_temp.exec_sqlstate(command text)
returns text
language plpgsql
as $$
begin
  execute command;
  return null;
exception when others then
  return sqlstate;
end $$;

create function pg_temp.act_as(person uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', person::text, true);
$$;

-- A member's device leaving, as `sharing_rls.sql` sends it.
create function pg_temp.leave(person uuid, list uuid)
returns text
language plpgsql
as $$
begin
  insert into public.list_members (id, list_id, user_id, role, name, deleted_at, tombstone_version)
  select m.id, m.list_id, m.user_id, m.role, m.name, now(), m.tombstone_version + 1
    from public.list_members m where m.list_id = list and m.user_id = person
  on conflict (id) do update set deleted_at = excluded.deleted_at, tombstone_version = excluded.tombstone_version;
  return null;
exception when others then
  return sqlstate;
end $$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'gital-offer-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'gital-offer-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'gital-offer-c@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'gital-offer-d@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

create temp table invites (who text primary key, token text) on commit drop;
grant all on invites to authenticated;
create temp table heads (who text primary key, head uuid) on commit drop;
grant all on heads to authenticated;

-- The shape.
select ok(
  not has_function_privilege('anon', 'public.offer_list(uuid, uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.list_offers()', 'execute')
    and not has_function_privilege('anon', 'public.answer_offer(uuid, boolean, text, jsonb)', 'execute'),
  'only a signed-in person offers, reads offers or answers one'
);
select ok(
  not has_function_privilege('authenticated', 'private.admit(uuid, text, text, jsonb)', 'execute'),
  'only the server''s own functions let anyone in'
);

-- A's lists: Market, which B joins by a link, and three to offer.
set local role authenticated;
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
insert into public.lists (id, name) values
  ('a0000000-0000-7000-8000-00000000000a', 'Market'),
  ('a0000000-0000-7000-8000-00000000000c', 'Pazar'),
  ('a0000000-0000-7000-8000-00000000000d', 'Fırın'),
  ('a0000000-0000-7000-8000-00000000000e', 'Eski');
insert into invites values ('B', public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'editor', 'Ömer'));
insert into invites values ('B-Fırın', public.create_list_invite('a0000000-0000-7000-8000-00000000000d', 'viewer', 'Ömer'));

reset role;
select is(
  pg_temp.exec_sqlstate($$insert into public.list_invites (list_id, role, created_by, expires_at)
    values ('a0000000-0000-7000-8000-00000000000a', 'editor', '10000000-0000-4000-8000-000000000001', 'infinity')$$)
  || pg_temp.exec_sqlstate($$insert into public.list_invites (list_id, role, created_by, expires_at, token_hash, invitee)
    values ('a0000000-0000-7000-8000-00000000000a', 'editor', '10000000-0000-4000-8000-000000000001', 'infinity',
            repeat('0', 64), '20000000-0000-4000-8000-000000000002')$$),
  '2351423514',
  'a row is a link or an offer: never neither, never both, so no link reaches an offer'
);
set local role authenticated;

select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select public.accept_list_invite((select token from invites where who = 'B'), 'Deniz')),
  'a0000000-0000-7000-8000-00000000000a'::uuid,
  'a link still joins as 1.6.0 sends it'
);

-- Who may offer what to whom.
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', 'editor', 'Deniz')$$),
  '42501',
  'only the owner offers'
);
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000c', '30000000-0000-4000-8000-000000000003', 'editor', 'Ömer')$$),
  'ZK005',
  'only to someone the owner already shares a list with'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000c', '10000000-0000-4000-8000-000000000001', 'editor', 'Ömer')$$),
  '22023',
  'never to oneself'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000a', '20000000-0000-4000-8000-000000000002', 'viewer', 'Ömer')$$),
  'ZK004',
  'nor to someone already in the list'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', 'owner', 'Ömer')$$),
  '22023',
  'no offer makes another owner'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', 'viewer', 'Ömer')$$),
  null,
  'A offers Pazar to B, with whom A shares Market'
);
select is(
  (select role || ':' || name from public.list_members
    where list_id = 'a0000000-0000-7000-8000-00000000000c' and user_id = '10000000-0000-4000-8000-000000000001'),
  'owner:Ömer',
  'the first offer makes the owner a member, as a first link does'
);
select is(
  (select string_agg(list_name || ':' || kind || ':' || role || ':' || from_name || ':' || to_user, ',') from public.list_offers()),
  'Pazar:shop:viewer:Ömer:20000000-0000-4000-8000-000000000002',
  'the owner reads the offer sent'
);

select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select string_agg(list_name || ':' || kind || ':' || role || ':' || from_name || ':' || to_user, ',') from public.list_offers()),
  'Pazar:shop:viewer:Ömer:20000000-0000-4000-8000-000000000002',
  'B reads the offer: which list, what kind, which role, from whom'
);
insert into heads values ('viewer', (select max_id from public.sync_cursors() where table_name = 'offers'));
select isnt((select head from heads where who = 'viewer'), null, 'and B''s change probe says an offer waits');

select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer');
select is(
  (select string_agg(role, ',') from public.list_offers()),
  'editor',
  'offering again changes the one offer''s role'
);
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select isnt(
  (select max_id from public.sync_cursors() where table_name = 'offers'),
  (select head from heads where who = 'viewer'),
  'and B''s change probe moves with it'
);
update heads set head = (select max_id from public.sync_cursors() where table_name = 'offers') where who = 'viewer';
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
update public.lists set name = 'Pazar yeri' where id = 'a0000000-0000-7000-8000-00000000000c';
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select isnt(
  (select max_id from public.sync_cursors() where table_name = 'offers'),
  (select head from heads where who = 'viewer'),
  'and with the list''s name, which the waiting card shows'
);
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
update public.lists set name = 'Pazar' where id = 'a0000000-0000-7000-8000-00000000000c';

select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select is((select count(*) from public.list_offers()), 0::bigint, 'someone else reads no offer');
select is((select max_id from public.sync_cursors() where table_name = 'offers'), null, 'and their probe names none');
select is(
  pg_temp.exec_sqlstate($$select public.answer_offer('a0000000-0000-7000-8000-00000000000c', true, 'Can')$$),
  '22023',
  'nor accepts an offer made to another'
);

-- B declines; A offers again and withdraws; A offers again and B accepts.
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is((select public.answer_offer('a0000000-0000-7000-8000-00000000000c', false, 'Deniz')), null::uuid, 'B declines');
select is(
  (select count(*) from public.list_offers()) + (select count(*) from public.lists where id = 'a0000000-0000-7000-8000-00000000000c'),
  0::bigint,
  'and the offer is gone, and B is not in Pazar'
);
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is((select count(*) from public.list_offers()), 0::bigint, 'nothing of the refusal is kept for the owner either');

select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer');
select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', null, 'Ömer');
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  pg_temp.exec_sqlstate($$select public.answer_offer('a0000000-0000-7000-8000-00000000000c', true, 'Deniz')$$),
  '22023',
  'an offer withdrawn cannot be accepted'
);

select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer');
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select public.offer_list('a0000000-0000-7000-8000-00000000000c', '20000000-0000-4000-8000-000000000002', null, 'Deniz');
select is((select count(*) from public.list_offers()), 1::bigint, 'only the owner withdraws an offer');
select is(
  (select public.answer_offer('a0000000-0000-7000-8000-00000000000c', true, 'Deniz')),
  'a0000000-0000-7000-8000-00000000000c'::uuid,
  'B accepts, and learns which list'
);
select is(
  (select role || ':' || name from public.list_members
    where list_id = 'a0000000-0000-7000-8000-00000000000c' and user_id = '20000000-0000-4000-8000-000000000002'),
  'editor:Deniz',
  'B is in Pazar at the role offered, under the name they gave'
);
select is(
  (select count(*) from public.list_offers())
    + (select count(*) from public.sync_cursors() where table_name = 'offers' and max_id is not null),
  0::bigint,
  'and the offer is spent'
);

-- A link to a list B has an offer to.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select public.offer_list('a0000000-0000-7000-8000-00000000000d', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer');
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select public.accept_list_invite((select token from invites where who = 'B-Fırın'), 'Deniz')),
  'a0000000-0000-7000-8000-00000000000d'::uuid,
  'B joins Fırın by a link while an offer to it waits'
);
select is((select count(*) from public.list_offers()), 0::bigint, 'and no offer is left to a list B is in');

-- An offer to a list its owner then deletes.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select public.offer_list('a0000000-0000-7000-8000-00000000000e', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer');
update public.lists set deleted_at = now(), tombstone_version = 1 where id = 'a0000000-0000-7000-8000-00000000000e';
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select count(*) from public.list_offers())
    + (select count(*) from public.sync_cursors() where table_name = 'offers' and max_id is not null),
  0::bigint,
  'an offer to a deleted list is shown no more'
);
select is(
  pg_temp.exec_sqlstate($$select public.answer_offer('a0000000-0000-7000-8000-00000000000e', true, 'Deniz')$$),
  '22023',
  'and joins nothing'
);

-- A's Kiler, while B's has C in it.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'viewer', 'Ömer')$$),
  '22023',
  'a household has no viewers'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'editor', 'Ömer')$$),
  null,
  'A offers their Kiler to B'
);
select is(
  (select kind || ':' || name from public.lists where id = '10000000-0000-4000-8000-000000000001'),
  'pantry:Kiler',
  'which makes the household, as a first link does'
);
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
insert into invites values ('C', public.create_list_invite('20000000-0000-4000-8000-000000000002', 'editor', 'Deniz'));
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select public.accept_list_invite((select token from invites where who = 'C'), 'Can', '[]');
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  pg_temp.exec_sqlstate($$select public.answer_offer('10000000-0000-4000-8000-000000000001', true, 'Deniz', '[]')$$),
  'ZK002',
  'B, whose Kiler someone is in, cannot accept'
);
select is(
  (select count(*) from public.list_offers() where kind = 'pantry'),
  1::bigint,
  'and the offer waits to be answered again'
);
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select pg_temp.leave('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002');
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select public.answer_offer('10000000-0000-4000-8000-000000000001', true, 'Deniz', '[]')),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'once C has left, B accepts'
);
select is(private.my_pantry(), '10000000-0000-4000-8000-000000000001'::uuid, 'and B''s Kiler is A''s');

-- D's household, which B, in A's, is offered.
select pg_temp.act_as('40000000-0000-4000-8000-000000000004');
insert into public.lists (id, name) values ('d0000000-0000-7000-8000-00000000000d', 'Ev');
insert into invites values ('B-Ev', public.create_list_invite('d0000000-0000-7000-8000-00000000000d', 'editor', 'Dilek'));
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select public.accept_list_invite((select token from invites where who = 'B-Ev'), 'Deniz');
select pg_temp.act_as('40000000-0000-4000-8000-000000000004');
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'editor', 'Dilek')$$),
  null,
  'D offers their Kiler to B, who is in another household: asked when answered, not when offered'
);
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  pg_temp.exec_sqlstate($$select public.answer_offer('40000000-0000-4000-8000-000000000004', true, 'Deniz', '[]')$$),
  'ZK001',
  'B, in A''s household, cannot accept D''s'
);
select is(
  (select count(*) from public.list_offers() where list_id = '40000000-0000-4000-8000-000000000004'),
  1::bigint,
  'and that offer waits too'
);
select is(
  pg_temp.exec_sqlstate($$select public.offer_list('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'editor', 'Deniz')$$),
  'ZK001',
  'nor, in A''s household, offers a Kiler of their own'
);

-- An account deleted takes the offers made to it.
select lives_ok($$select public.delete_own_account()$$, 'B deletes their account');
reset role;
select is(
  (select count(*) from public.list_invites where invitee = '20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'and no offer to B is left'
);

select * from finish();
rollback;
