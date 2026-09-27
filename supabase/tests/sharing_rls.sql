-- What sharing lets each person do (migration 5): an owner, an editor, a
-- viewer and someone outside. `sync_rls.sql`'s harness: fixtures as postgres,
-- every assertion as the role a request would carry, and a rollback at the end.
begin;

set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(31);

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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'gital-share-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'gital-share-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '30000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'gital-share-c@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- The shape.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'list_members'
      and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type not in ('SELECT','UPDATE')))),
  0::bigint,
  'a signed-in request only reads and updates members; nobody inserts one directly'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'list_invites' and grantee in ('anon', 'authenticated')),
  0::bigint,
  'invitations are the server''s alone'
);

-- A's list, with one thing on it.
set local role authenticated;
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
insert into public.lists (id, name) values ('a0000000-0000-7000-8000-00000000000a', 'Market');
insert into public.items (id, list_id, name) values ('a1000000-0000-7000-8000-00000000000a', 'a0000000-0000-7000-8000-00000000000a', 'süt');

select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is((select count(*) from public.items), 0::bigint, 'B sees nothing of A''s list before an invitation');
select is(
  pg_temp.exec_sqlstate($$select public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'editor', 'B')$$),
  '42501',
  'only the owner invites'
);

select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
create temp table invites (who text primary key, token text) on commit drop;
insert into invites values ('B', public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'editor', 'Ömer'));
insert into invites values ('C', public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'viewer', 'Ömer'));
select ok((select bool_and(token ~ '^[0-9a-f]{64}$') from invites), 'an invitation is 256 random bits, as hex');
select is(
  (select role || ':' || name from public.list_members where user_id = '10000000-0000-4000-8000-000000000001'),
  'owner:Ömer',
  'the first invitation makes the owner a member too'
);
select is(
  pg_temp.exec_sqlstate($$select public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'owner', 'Ömer')$$),
  '22023',
  'no invitation makes another owner'
);

-- B joins as an editor.
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite('0000000000000000000000000000000000000000000000000000000000000000', 'B')$$),
  '22023',
  'a made-up token opens nothing'
);
select is(
  (select public.accept_list_invite((select token from invites where who = 'B'), 'Deniz')),
  'a0000000-0000-7000-8000-00000000000a'::uuid,
  'B joins by the link, and learns which list'
);
select is((select count(*) from public.items), 1::bigint, 'B now reads what is on the list');
select is((select count(*) from public.list_members), 2::bigint, 'and who is in it');
select lives_ok(
  $$insert into public.items (id, list_id, name) values ('b1000000-0000-7000-8000-00000000000b', 'a0000000-0000-7000-8000-00000000000a', 'ekmek')$$,
  'an editor adds to the list'
);
update public.lists set deleted_at = now(), tombstone_version = 1 where id = 'a0000000-0000-7000-8000-00000000000a';
select is(
  (select deleted_at from public.lists where id = 'a0000000-0000-7000-8000-00000000000a'),
  null,
  'an editor cannot delete the owner''s list'
);
update public.list_members set role = 'owner', seen_at = now() where user_id = '20000000-0000-4000-8000-000000000002';
select is(
  (select role from public.list_members where user_id = '20000000-0000-4000-8000-000000000002'),
  'editor',
  'nor make themselves its owner'
);
select isnt(
  (select seen_at from public.list_members where user_id = '20000000-0000-4000-8000-000000000002'),
  null,
  'though they keep when they last looked'
);
update public.list_members set name = 'X', role = 'viewer' where user_id = '10000000-0000-4000-8000-000000000001';
select is(
  (select role || ':' || name from public.list_members where user_id = '10000000-0000-4000-8000-000000000001'),
  'owner:Ömer',
  'nor touch the owner''s row'
);

-- C joins as a viewer; the link B used is spent.
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite((select token from invites where who = 'B'), 'C')$$),
  '22023',
  'an invitation works once'
);
select is(
  (select public.accept_list_invite((select token from invites where who = 'C'), 'Ayşe')),
  'a0000000-0000-7000-8000-00000000000a'::uuid,
  'C joins as a viewer'
);
select is((select count(*) from public.items), 2::bigint, 'a viewer reads the list');
select is(
  pg_temp.exec_sqlstate($$insert into public.items (id, list_id, name) values ('c1000000-0000-7000-8000-00000000000c', 'a0000000-0000-7000-8000-00000000000a', 'yağ')$$),
  '42501',
  'but adds nothing'
);
update public.items set name = 'kahve' where id = 'a1000000-0000-7000-8000-00000000000a';
select is(
  (select name from public.items where id = 'a1000000-0000-7000-8000-00000000000a'),
  'süt',
  'and changes nothing'
);

-- The owner removes C, and C cannot come back by itself.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
update public.list_members set deleted_at = now(), tombstone_version = 1 where user_id = '30000000-0000-4000-8000-000000000003';
update public.list_members set deleted_at = now(), tombstone_version = 1 where user_id = '10000000-0000-4000-8000-000000000001';
select is(
  (select deleted_at from public.list_members where user_id = '10000000-0000-4000-8000-000000000001'),
  null,
  'the owner does not leave their own list'
);
select pg_temp.act_as('30000000-0000-4000-8000-000000000003');
select is((select count(*) from public.items), 0::bigint, 'a removed member reads nothing more');
select isnt(
  (select deleted_at from public.list_members where user_id = '30000000-0000-4000-8000-000000000003'),
  null,
  'but sees their own removal, so the device can let the list go'
);
update public.list_members set deleted_at = null where user_id = '30000000-0000-4000-8000-000000000003';
select is((select count(*) from public.items), 0::bigint, 'and cannot undo it');

-- B leaves.
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
update public.list_members set deleted_at = now(), tombstone_version = 1 where user_id = '20000000-0000-4000-8000-000000000002';
select is((select count(*) from public.lists), 0::bigint, 'a member who leaves reads the list no more');

-- An invitation past its week opens nothing.
select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
insert into invites values ('late', public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'editor', 'Ömer'));
reset role;
update public.list_invites set expires_at = now() - interval '1 second';
set local role authenticated;
select pg_temp.act_as('20000000-0000-4000-8000-000000000002');
select is(
  pg_temp.exec_sqlstate($$select public.accept_list_invite((select token from invites where who = 'late'), 'B')$$),
  '22023',
  'an invitation expires'
);

select pg_temp.act_as('10000000-0000-4000-8000-000000000001');
select ok(
  (select count(*) = 1 from public.sync_cursors() where table_name = 'list_members' and max_id is not null),
  'the change probe counts members'
);
select lives_ok(
  $$update public.lists set deleted_at = now(), tombstone_version = 1 where id = 'a0000000-0000-7000-8000-00000000000a'$$,
  'the owner deletes their list'
);
select isnt(
  (select deleted_at from public.lists where id = 'a0000000-0000-7000-8000-00000000000a'),
  null,
  'and it is deleted'
);
select is(
  pg_temp.exec_sqlstate($$select public.create_list_invite('a0000000-0000-7000-8000-00000000000a', 'editor', 'Ömer')$$),
  '42501',
  'a deleted list invites no one'
);

select * from finish();
rollback;
