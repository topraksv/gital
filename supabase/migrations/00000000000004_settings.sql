-- Settings (SPEC 9.1): what follows the person to every device, Helix's key
-- and JSON value. Today only whether the account is frozen, which has to
-- reach every device the account holds. A person's own row, as a product is:
-- its id is a hash of the key, so the person is part of the primary key.

begin;

create table public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  tombstone_version bigint not null default 0 check (tombstone_version >= 0),
  key text not null check (char_length(key) between 1 and 64),
  value text not null check (char_length(value) <= 10000),
  primary key (user_id, id)
);

alter table public.settings enable row level security;
create policy settings_select on public.settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy settings_insert on public.settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy settings_update on public.settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create index settings_pull on public.settings (user_id, updated_at, id);

create trigger set_updated_at before insert or update on public.settings
  for each row execute function public.set_updated_at();
revoke all on table public.settings from anon, authenticated;
grant select, insert, update on table public.settings to authenticated;
grant all on table public.settings to service_role;

-- The change probe, with the new table's head.
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
    left join lateral (select h.updated_at, h.id from public.pantry_moves h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true
  union all
  select 'settings'::text, k.updated_at, k.id from (select 1) probe
    left join lateral (select h.updated_at, h.id from public.settings h where h.user_id = (select auth.uid()) order by h.updated_at desc, h.id desc limit 1) k on true;
$$;

commit;
