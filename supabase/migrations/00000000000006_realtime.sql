-- Realtime as a nudge (SPEC 1.3, 1.6; `docs/ARCHITECTURE.md`, 2026-09-23): a
-- list has a private channel, `list:<id>`. The server says on it that the list
-- moved, from a trigger, and the rows still come by the pull; its members say
-- on it who is shopping, as presence, which nothing stores. Only members hear
-- it, and only they speak there, and then only presence.

begin;

-- The list a channel is for, or null for a topic that names none.
create or replace function public.list_of_topic(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when topic ~ '^list:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then pg_catalog.substr(topic, 6)::uuid end;
$$;

create policy list_channel_hear on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.can_read_list(public.list_of_topic((select realtime.topic())))
  );
create policy list_channel_presence on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and public.can_read_list(public.list_of_topic((select realtime.topic())))
  );

-- The server's word, as its owner: `realtime.send` writes as its caller and
-- swallows a refusal as a warning, and a member may not broadcast. It names
-- who moved the list, so their own devices need not pull what they pushed.
create or replace function public.nudge_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    pg_catalog.jsonb_build_object('by', auth.uid()),
    'moved',
    'list:' || (pg_catalog.to_jsonb(new) ->> case when tg_table_name = 'lists' then 'id' else 'list_id' end),
    true
  );
  return null;
end;
$$;

revoke all on function public.nudge_list() from public, anon, authenticated;

create trigger nudge_list after insert or update on public.lists
  for each row execute function public.nudge_list();
create trigger nudge_list after insert or update on public.list_members
  for each row execute function public.nudge_list();
create trigger nudge_list after insert or update on public.shops
  for each row execute function public.nudge_list();
create trigger nudge_list after insert or update on public.items
  for each row execute function public.nudge_list();
create trigger nudge_list after insert or update on public.wishes
  for each row execute function public.nudge_list();
create trigger nudge_list after insert or update on public.wish_links
  for each row execute function public.nudge_list();

commit;
