-- Three things devil rounds 2026-10-09-1 and -2 proved one copy could do to
-- another, closed where only the server can close them.
--
-- 1. A row made afresh over a live one. Shops, items, products and pantry
-- items take ids from what they name, so a device that never pulled the
-- server's row makes its own under the same id, and its push replaced that
-- row whole: a second device finishing the same shop number cleared the
-- receipt and the total. A fresh row is told by its `created_at`, which a
-- device keeps from the row it pulled; meeting a live row, what it says still
-- wins, but its nulls blank nothing it never saw, and the row keeps the day it
-- was first made. A device may write one on purpose to revive a row a reset it
-- missed took (`isAddedAgain`). Rejected: refusing the write, which would hold
-- that device's outbox for good.
create or replace function private.keep_live_values()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and old.deleted_at is null and new.deleted_at is null
     -- To the millisecond, as a device holds it: a row the server made, as
     -- `join_household` makes a Kiler's, carries microseconds the device
     -- cuts, and its every edit would read as fresh.
     and pg_catalog.date_trunc('milliseconds', new.created_at)
         is distinct from pg_catalog.date_trunc('milliseconds', old.created_at) then
    new := pg_catalog.jsonb_populate_record(old, pg_catalog.jsonb_strip_nulls(pg_catalog.to_jsonb(new)));
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function private.keep_live_values() from public, anon;

-- Before `set_updated_at`, which then stamps the merged row; triggers run by name.
create trigger keep_live_values before update on public.shops
  for each row execute function private.keep_live_values();
create trigger keep_live_values before update on public.items
  for each row execute function private.keep_live_values();
create trigger keep_live_values before update on public.products
  for each row execute function private.keep_live_values();
create trigger keep_live_values before update on public.pantry_items
  for each row execute function private.keep_live_values();

-- 2. A photo named to be read. A photo is read by whoever can read a row
-- naming it (`can_see_photo`), and nothing checked the name when a row was
-- written: someone removed from a list, who had seen a photo's id, could name
-- it on a row of their own list and read it on. A row may name a photo that
-- is not there yet (the app sends a photo before its row, and one Storage
-- refused for good goes up unnamed) or one its writer can already read; any
-- other is dropped from the row rather than refused, so the device's outbox
-- is never held by it.
create or replace function private.photo_stored(photo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from storage.objects o
     where o.bucket_id = 'photos' and public.photo_of_object(o.name) = photo
  );
$$;

revoke all on function private.photo_stored(uuid) from public, anon;
grant execute on function private.photo_stored(uuid) to authenticated;

-- As the writer, so `storage.objects` answers with what they may read.
create or replace function private.forget_unseen_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and new.photo_id is not null
     and (tg_op = 'INSERT' or new.photo_id is distinct from old.photo_id)
     and private.photo_stored(new.photo_id)
     and not exists (
       select 1 from storage.objects o
        where o.bucket_id = 'photos' and public.photo_of_object(o.name) = new.photo_id
     ) then
    new.photo_id := null;
  end if;
  return new;
end;
$$;

revoke all on function private.forget_unseen_photo() from public, anon;

create trigger forget_unseen_photo before insert or update on public.items
  for each row execute function private.forget_unseen_photo();
create trigger forget_unseen_photo before insert or update on public.wishes
  for each row execute function private.forget_unseen_photo();
create trigger forget_unseen_photo before insert or update on public.shops
  for each row execute function private.forget_unseen_photo();

-- 3. A number no device can hold. The app keeps every synced integer as a
-- JavaScript number, and a pull refuses a whole page holding one past 2^53 so
-- that nothing lands behind a cursor that moved past it — which left one
-- member's `sort_order` of 2^60 stopping every other member's pull of that
-- list for good. The device cannot skip such a row without losing it, so the
-- server stops taking it, in every bigint column the app syncs.
do $$
declare
  c record;
begin
  for c in
    select table_name, column_name from information_schema.columns
     where table_schema = 'public' and data_type = 'bigint'
       and table_name in ('lists', 'list_members', 'shops', 'items', 'wishes', 'wish_links',
                          'products', 'sets', 'set_items', 'pantry_items', 'pantry_moves', 'settings')
  loop
    execute format(
      'alter table public.%I add constraint %I check (%I between -9007199254740991 and 9007199254740991)',
      c.table_name, c.column_name || '_fits_device', c.column_name);
  end loop;
end;
$$;
