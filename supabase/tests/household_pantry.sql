-- One household Kiler (migration 12): A's Kiler, B who joins it bringing
-- theirs, D's household that C joins empty. `sync_rls.sql`'s harness:
-- fixtures as postgres, every assertion as the role a request would carry,
-- and a rollback at the end.
begin;

set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(40);

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

-- What a device's push of a pantry row is: PostgREST's upsert on the
-- person's key, returning the row, which the select policy must pass.
create function pg_temp.push_item(home uuid, item uuid, item_name text)
returns text
language plpgsql
as $$
begin
  insert into public.pantry_items (user_id, id, name) values (home, item, item_name)
  on conflict (user_id, id) do update set name = excluded.name
  returning id into item;
  return null;
exception when others then
  return sqlstate;
end $$;

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
   'authenticated', 'authenticated', 'gital-home-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'gital-home-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'gital-home-c@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'gital-home-d@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

create temp table invites (who text primary key, token text) on commit drop;
grant all on invites to authenticated;
create temp table heard (n bigint) on commit drop;
grant all on heard to authenticated;

-- A's Kiler: milk, and eggs once had and deleted. B's: milk too, and bread.
-- Ids are shared by name across Kilers, as the device makes them.
set local role authenticated;
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
insert into public.pantry_items (id, name) values ('f1000000-0000-7000-8000-000000000001', 'Süt');
insert into public.pantry_moves (id, pantry_item_id, quantity_milli, unit)
  values ('e1000000-0000-7000-8000-00000000000a', 'f1000000-0000-7000-8000-000000000001', 2000, 'lt');
insert into public.pantry_items (id, name, deleted_at) values ('f5000000-0000-7000-8000-000000000005', 'Yumurta', now());

select is(private.my_pantry(), '10000000-0000-4000-8000-000000000001'::uuid, 'outside a household, a person''s Kiler is their own');
select is(
  (select max_id from public.sync_cursors() where table_name = 'pantry_home'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'the change probe says which Kiler the person is in'
);

select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
insert into public.pantry_items (id, name) values ('f1000000-0000-7000-8000-000000000001', 'Süt'), ('f2000000-0000-7000-8000-000000000002', 'Ekmek');
insert into public.pantry_moves (id, pantry_item_id, quantity_milli, unit) values
  ('e2000000-0000-7000-8000-00000000000b', 'f1000000-0000-7000-8000-000000000001', 1000, 'lt'),
  ('e3000000-0000-7000-8000-00000000000b', 'f2000000-0000-7000-8000-000000000002', 3000, 'adet');
reset role;
select is(
  (select count(*) from realtime.messages where topic = 'list:20000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a Kiler nobody shares tells no channel'
);
set local role authenticated;

-- Only the server makes a household, and nobody takes an account's id.
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select is(
  pg_temp.exec_sqlstate($$insert into public.lists (id, name) values ('10000000-0000-4000-8000-000000000001', 'Benim')$$),
  '42501',
  'a list cannot take another account''s id, which is that account''s household'
);
select is(
  pg_temp.exec_sqlstate($$insert into public.lists (id, name, kind) values ('30000000-0000-4000-8000-000000000003', 'Kiler', 'pantry')$$),
  '42501',
  'a device never makes a household'
);

-- A invites into their Kiler.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is(
  pg_temp.exec_sqlstate($$select public.create_list_invite('10000000-0000-4000-8000-000000000001', 'viewer', 'Ömer')$$),
  '22023',
  'a household has no viewers'
);
insert into invites values ('B', public.create_list_invite('10000000-0000-4000-8000-000000000001', 'editor', 'Ömer'));
insert into invites values ('C', public.create_list_invite('10000000-0000-4000-8000-000000000001', 'editor', 'Ömer'));
insert into invites values ('D', public.create_list_invite('10000000-0000-4000-8000-000000000001', 'editor', 'Ömer'));
select ok((select bool_and(token ~ '^[0-9a-f]{64}$') from invites), 'the owner''s first invitation into their Kiler gives a link');
select is(
  (select kind || ':' || name from public.lists where id = '10000000-0000-4000-8000-000000000001'),
  'pantry:Kiler',
  'and makes the household, whose id is the owner''s'
);

-- B looks at the link, then joins bringing their own.
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  (select kind || ':' || name || ':' || inviter from public.peek_list_invite((select token from invites where who = 'B'))),
  'pantry:Kiler:Ömer',
  'a link says what it opens and who sent it'
);
select is(
  (select count(*) from public.peek_list_invite('0000000000000000000000000000000000000000000000000000000000000000')),
  0::bigint,
  'a made-up link says nothing'
);
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite((select token from invites where who = 'B'), 'Deniz')$$),
  'ZK003',
  'a client that cannot ask what to bring is refused, and the link is not spent'
);
select is(
  (select public.accept_list_invite((select token from invites where who = 'B'), 'Deniz', $$[
    {"id": "f1000000-0000-7000-8000-000000000001", "name": "Süt", "list_id": null, "expires_on": null, "quantity_milli": 1000, "unit": "lt"},
    {"id": "f2000000-0000-7000-8000-000000000002", "name": "Ekmek", "list_id": null, "expires_on": "2026-10-09", "quantity_milli": 3000, "unit": "adet"},
    {"id": "f5000000-0000-7000-8000-000000000005", "name": "Yumurta", "list_id": null, "expires_on": null, "quantity_milli": 6000, "unit": "adet"}
  ]$$::jsonb)),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'B joins A''s Kiler with what they have'
);
select is(private.my_pantry(), '10000000-0000-4000-8000-000000000001'::uuid, 'B''s Kiler is now A''s');
select is(
  (select max_id from public.sync_cursors() where table_name = 'pantry_home'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'and the change probe says so, so B''s devices switch'
);
select is(
  (select string_agg(name, ',' order by name) from public.pantry_items where deleted_at is null),
  'Ekmek,Süt,Yumurta',
  'B reads the household''s Kiler with their own things in it'
);
select is(
  (select sum(quantity_milli) from public.pantry_moves where pantry_item_id = 'f1000000-0000-7000-8000-000000000001' and deleted_at is null),
  3000::numeric,
  'a product both had is one row, holding both amounts'
);
select is(
  (select expires_on from public.pantry_items where id = 'f2000000-0000-7000-8000-000000000002'),
  '2026-10-09'::date,
  'what is brought keeps its date'
);
select is(
  (select tombstone_version from public.pantry_items where id = 'f5000000-0000-7000-8000-000000000005' and deleted_at is null),
  1::bigint,
  'a product the household had deleted comes back at its generation'
);
select is(
  pg_temp.push_item('10000000-0000-4000-8000-000000000001', 'f3000000-0000-7000-8000-000000000003', 'Yağ'),
  null,
  'B''s device writes into the household'
);
select is(
  pg_temp.push_item('20000000-0000-4000-8000-000000000002', 'f4000000-0000-7000-8000-000000000004', 'Un'),
  '42501',
  'but a device still holding B''s own Kiler is refused, never sent into another'
);
select is(
  (select max_id from public.sync_cursors() where table_name = 'pantry_items'),
  'f5000000-0000-7000-8000-000000000005'::uuid,
  'the probe gives B the household''s head, not their own'
);
select is(
  (select public.accept_list_invite((select token from invites where who = 'D'), 'Deniz', '[]')),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'a second link into the same household changes nothing'
);
update public.lists set kind = 'shop' where id = '10000000-0000-4000-8000-000000000001';
select is(
  (select kind from public.lists where id = '10000000-0000-4000-8000-000000000001'),
  'pantry',
  'a member cannot turn the household into a list'
);

reset role;
select is(
  (select count(*) from public.pantry_items where user_id = '20000000-0000-4000-8000-000000000002' and deleted_at is null)
    + (select count(*) from public.pantry_moves where user_id = '20000000-0000-4000-8000-000000000002' and deleted_at is null),
  0::bigint,
  'B''s own Kiler is emptied as they join, so leaving starts empty'
);
select is(
  (select count(*) from public.list_members where list_id = '10000000-0000-4000-8000-000000000001' and user_id = '20000000-0000-4000-8000-000000000002'),
  1::bigint,
  'B is in once'
);
insert into heard select count(*) from realtime.messages where topic = 'list:10000000-0000-4000-8000-000000000001';
set local role authenticated;

select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is(
  (select string_agg(name, ',' order by name) from public.pantry_items where deleted_at is null),
  'Ekmek,Süt,Yağ,Yumurta',
  'A sees what B brought and wrote'
);
select is(pg_temp.push_item('10000000-0000-4000-8000-000000000001', 'f6000000-0000-7000-8000-000000000006', 'Pirinç'), null, 'A writes as before');
reset role;
select ok(
  (select count(*) from realtime.messages where topic = 'list:10000000-0000-4000-8000-000000000001') > (select n from heard),
  'a household''s change is told on its channel'
);
set local role authenticated;

-- D's household, which C joins empty.
select pg_temp.act_as('40000000-0000-4000-8000-000000000004');
insert into invites values ('D-C', public.create_list_invite('40000000-0000-4000-8000-000000000004', 'editor', 'Dilek'));
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
insert into public.pantry_items (id, name) values ('f7000000-0000-7000-8000-000000000007', 'Çay');
select is((select count(*) from public.pantry_items where name = 'Süt'), 0::bigint, 'someone outside reads no household');
select is(
  (select public.accept_list_invite((select token from invites where who = 'D-C'), 'Can', '[]')),
  '40000000-0000-4000-8000-000000000004'::uuid,
  'C joins D''s Kiler empty'
);
select is((select count(*) from public.pantry_items), 0::bigint, 'bringing nothing brings nothing');
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite((select token from invites where who = 'C'), 'Can', '[]')$$),
  'ZK001',
  'someone in one household cannot join another'
);
select is(
  pg_temp.exec_sqlstate($$select public.create_list_invite('30000000-0000-4000-8000-000000000003', 'editor', 'Can')$$),
  'ZK001',
  'nor invite anyone into a Kiler of their own'
);
select pg_temp.act_as('40000000-0000-4000-8000-000000000004');
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite((select token from invites where who = 'C'), 'Dilek', '[]')$$),
  'ZK002',
  'and an owner whose Kiler others are in cannot join another'
);

-- B leaves: their Kiler is their own again, and empty.
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(pg_temp.leave('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'), null, 'B leaves the household');
select is(private.my_pantry(), '20000000-0000-4000-8000-000000000002'::uuid, 'B''s Kiler is their own again');
select is((select count(*) from public.pantry_items where deleted_at is null), 0::bigint, 'and starts empty');
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select is((select count(*) from public.pantry_items where deleted_at is null), 5::bigint, 'what B brought stays in the household');

reset role;
select ok(not has_function_privilege('anon', 'public.peek_list_invite(text)', 'execute'), 'only a signed-in person looks at a link');
select is(
  (select count(*) from pg_proc where proname = 'accept_list_invite'),
  1::bigint,
  'one way to accept, so PostgREST never has two to choose from'
);

select * from finish();
rollback;
