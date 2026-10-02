-- What sync's tables let one account do to another's rows, asserted
-- (migrations 3 to 5, and 7). Helix's harness: fixtures as postgres, every assertion as
-- the role a request would carry, and a rollback at the end.
begin;

set local role postgres;
set local search_path = extensions, public, pg_catalog;

select extensions.plan(52);

-- SQLSTATE, not message text, under whichever role is active.
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

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'gital-rls-a@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'gital-rls-b@example.invalid', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- The shape: three policies per table, all for signed-in requests, no delete.
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = any (array['lists','shops','items','wishes','wish_links','products','sets','set_items','pantry_items','pantry_moves','settings'])
      and roles = array['authenticated']::name[]),
  33::bigint,
  'eleven synced tables, each with select, insert and update policies for authenticated'
);
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any (array['lists','shops','items','wishes','wish_links','products','sets','set_items','pantry_items','pantry_moves','settings'])
      and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type not in ('SELECT','INSERT','UPDATE')))),
  0::bigint,
  'anon holds nothing, and a signed-in request cannot delete'
);
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and c.relname = any (array['lists','shops','items','wishes','wish_links','products','sets','set_items','pantry_items','pantry_moves','settings'])),
  0::bigint,
  'every synced table has row-level security on'
);

-- ---------------------------------------------------------------------------
-- A writes a list, what is on it, and a product.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.lists (id, name, updated_at) values ('a0000000-0000-7000-8000-00000000000a', 'Market', '2000-01-01')$$,
  'A makes a list'
);
select is(
  (select owner_id from public.lists where id = 'a0000000-0000-7000-8000-00000000000a'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'the list is owned by whoever made it'
);
select ok(
  (select updated_at > now() - interval '1 minute' from public.lists where id = 'a0000000-0000-7000-8000-00000000000a'),
  'updated_at is the server''s clock, not the device''s'
);
select lives_ok(
  $$insert into public.items (id, list_id, name, photo_id) values
    ('a1000000-0000-7000-8000-00000000000a', 'a0000000-0000-7000-8000-00000000000a', 'süt', 'f0000000-0000-7000-8000-00000000000f')$$,
  'A puts an item with a photo on the list'
);
select lives_ok(
  $$insert into public.shops (id, list_id, number, finished_at) values
    ('a2000000-0000-7000-8000-00000000000a', 'a0000000-0000-7000-8000-00000000000a', 1, now())$$,
  'A finishes a shop'
);
select lives_ok(
  $$insert into public.products (user_id, id, name) values
    ('10000000-0000-4000-8000-000000000001', 'b0000000-0000-8000-8000-00000000000b', 'süt')$$,
  'A keeps a product'
);
select is(
  pg_temp.exec_sqlstate($$insert into public.products (user_id, id, name) values
    ('20000000-0000-4000-8000-000000000002', 'b1000000-0000-8000-8000-00000000000b', 'süt')$$),
  '42501',
  'A cannot write a product into B''s name'
);
select lives_ok(
  $$insert into public.settings (user_id, id, key, value) values
    ('10000000-0000-4000-8000-000000000001', 'b4000000-0000-8000-8000-00000000000b', 'account_frozen', 'true')$$,
  'A freezes its account'
);
select is(
  pg_temp.exec_sqlstate($$delete from public.items where id = 'a1000000-0000-7000-8000-00000000000a'$$),
  '42501',
  'a delete is refused: deletes are tombstones'
);

-- Delete generations (Helix's migration 12).
update public.items set deleted_at = now() where id = 'a1000000-0000-7000-8000-00000000000a';
select is(
  (select tombstone_version from public.items where id = 'a1000000-0000-7000-8000-00000000000a'),
  1::bigint,
  'a delete moves the generation on by one'
);
update public.items set deleted_at = null, name = 'eski', tombstone_version = 0 where id = 'a1000000-0000-7000-8000-00000000000a';
select ok(
  (select deleted_at is not null and name = 'süt' from public.items where id = 'a1000000-0000-7000-8000-00000000000a'),
  'a device that never saw the delete cannot undo it'
);
select is(
  pg_temp.exec_sqlstate($$update public.items set tombstone_version = 7 where id = 'a1000000-0000-7000-8000-00000000000a'$$),
  '23514',
  'a generation from nowhere is refused'
);
update public.items set deleted_at = null, tombstone_version = 1 where id = 'a1000000-0000-7000-8000-00000000000a';
select ok(
  (select deleted_at is null and tombstone_version = 1 from public.items where id = 'a1000000-0000-7000-8000-00000000000a'),
  'an undo at the generation it saw brings the row back'
);

update public.lists set owner_id = '20000000-0000-4000-8000-000000000002' where id = 'a0000000-0000-7000-8000-00000000000a';
select is(
  (select owner_id from public.lists where id = 'a0000000-0000-7000-8000-00000000000a'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'a write cannot hand the list to someone else'
);
select is(
  (select max_id from public.sync_cursors() where table_name = 'lists'),
  'a0000000-0000-7000-8000-00000000000a'::uuid,
  'the probe reports A''s list as the head'
);
select is(
  (select count(*) from public.sync_cursors()),
  14::bigint,
  'the probe names every synced table, which Kiler the person is in, and whether an offer waits'
);

-- ---------------------------------------------------------------------------
-- B sees none of it and cannot reach it.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);

select is((select count(*) from public.lists), 0::bigint, 'B sees no list of A''s');
select is((select count(*) from public.items), 0::bigint, 'B sees no item of A''s');
select is((select count(*) from public.shops), 0::bigint, 'B sees no shop of A''s');
select is((select count(*) from public.products), 0::bigint, 'B sees no product of A''s');
select is((select count(*) from public.settings), 0::bigint, 'B sees no setting of A''s');
select ok(not private.can_read_list('a0000000-0000-7000-8000-00000000000a'), 'B cannot read A''s list');
select ok(not private.can_write_list('a0000000-0000-7000-8000-00000000000a'), 'B cannot write A''s list');
select is(
  pg_temp.exec_sqlstate($$insert into public.items (id, list_id, name) values
    ('b2000000-0000-7000-8000-00000000000b', 'a0000000-0000-7000-8000-00000000000a', 'ekmek')$$),
  '42501',
  'B cannot put an item on A''s list'
);
select is(
  pg_temp.exec_sqlstate($$insert into public.lists (id, owner_id, name) values
    ('b3000000-0000-7000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'Sahte')$$),
  '42501',
  'B cannot make a list in A''s name'
);
update public.items set name = 'x' where id = 'a1000000-0000-7000-8000-00000000000a';
update public.lists set name = 'x' where id = 'a0000000-0000-7000-8000-00000000000a';
select is(
  pg_temp.exec_sqlstate($$insert into public.lists (id, name) values ('a0000000-0000-7000-8000-00000000000a', 'Ele geçir')
    on conflict (id) do update set name = excluded.name$$),
  '42501',
  'B cannot take A''s list by upserting its id'
);
select lives_ok(
  $$insert into public.products (user_id, id, name) values
    ('20000000-0000-4000-8000-000000000002', 'b0000000-0000-8000-8000-00000000000b', 'süt')$$,
  'B keeps a product under the same id as A''s: the person is part of the key'
);
select is(
  (select max_updated_at from public.sync_cursors() where table_name = 'lists'),
  null::timestamptz,
  'the probe reports no list head to B'
);

-- Photos: read by whoever can read a row naming them, and by the uploader.
set local role postgres;
insert into storage.objects (bucket_id, name, owner_id) values
  ('photos', 'f0000000-0000-7000-8000-00000000000f/full.jpg', '10000000-0000-4000-8000-000000000001'),
  ('photos', 'f1000000-0000-7000-8000-00000000000f/full.jpg', '10000000-0000-4000-8000-000000000001');
set local role authenticated;

select is(
  (select count(*) from storage.objects where bucket_id = 'photos'),
  0::bigint,
  'B reads no photo of A''s'
);
select is(
  pg_temp.exec_sqlstate($$insert into storage.objects (bucket_id, name, owner_id) values
    ('photos', 'not-a-photo.png', '20000000-0000-4000-8000-000000000002')$$),
  '42501',
  'a name the app never makes is refused'
);
select is(
  (select count(*) from public.own_photo_objects()),
  0::bigint,
  'B owns no photo'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from storage.objects where bucket_id = 'photos'),
  2::bigint,
  'A reads both photos it uploaded'
);
select is(
  (select count(*) from public.own_photo_objects()),
  2::bigint,
  'A''s own photos are listed for its deletion'
);
select ok(public.can_see_photo('f0000000-0000-7000-8000-00000000000f'), 'A can see the photo its item names');
select ok(not public.can_see_photo('f1000000-0000-7000-8000-00000000000f'), 'no row names the other photo');
update public.shops set photo_id = 'f1000000-0000-7000-8000-00000000000f' where id = 'a2000000-0000-7000-8000-00000000000a';
select ok(public.can_see_photo('f1000000-0000-7000-8000-00000000000f'), 'a shop naming it as its receipt makes it seen');
select is(public.photo_of_object('f0000000-0000-7000-8000-00000000000f/thumb.jpg'), 'f0000000-0000-7000-8000-00000000000f'::uuid, 'a thumbnail''s name gives its photo');
select is(public.photo_of_object('../f0000000-0000-7000-8000-00000000000f/full.jpg'), null::uuid, 'a path that climbs gives none');

-- Feedback's send limit (migration 7): five an hour, and a ledger nobody reads.
select ok(
  (select bool_and(public.record_feedback_send()) from generate_series(1, 5)),
  'A sends five reports in an hour'
);
select ok(not public.record_feedback_send(), 'but not a sixth');
select is(
  pg_temp.exec_sqlstate($$delete from public.feedback_reports$$),
  '42501',
  'and cannot erase what counts against it'
);
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select ok(public.record_feedback_send(), 'B''s limit is B''s own');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

-- Deleting the account takes every row it owns.
select lives_ok($$select public.delete_own_account()$$, 'A deletes its account');

set local role postgres;
select is((select count(*) from public.lists where owner_id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'A''s lists went with it');
select is((select count(*) from public.items where list_id = 'a0000000-0000-7000-8000-00000000000a'), 0::bigint, 'and what was on them');
select is((select count(*) from public.products where user_id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'and its products');
select is((select count(*) from public.settings where user_id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'and its settings');
select is((select count(*) from public.products where user_id = '20000000-0000-4000-8000-000000000002'), 1::bigint, 'B''s product stays');

-- Migration 11: the helpers RLS calls sit outside the API schema, so no
-- request can call them by RPC to probe which lists exist.
select is(
  (select array_agg(proname::text order by proname) from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('can_read_list', 'can_write_list', 'is_list_owner', 'is_member_row')),
  null,
  'no RLS helper is callable through the API'
);

select * from extensions.finish();
rollback;
