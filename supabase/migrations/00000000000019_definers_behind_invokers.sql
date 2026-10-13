-- Definer RPCs leave the exposed schema; an invoker of the same name stays.
--
-- The security advisor flags every SECURITY DEFINER function a client role can
-- call through `/rest/v1/rpc` (lints 0028, 0029). These eleven are the
-- client's API on purpose, so neither revoking them nor making them invokers
-- is open: each needs its owner's rights for rows the caller cannot reach. The
-- advisor's third remedy keeps them: the definer moves to a schema PostgREST
-- does not expose, and `public` keeps an invoker with the same name, arguments,
-- defaults and grants that calls it. A client calls exactly what it called
-- before; SET SCHEMA carries each function's body, owner, search_path and
-- grants with it.
--
-- The invoker runs as the caller, so the caller's roles need USAGE on that
-- schema. `definers` holds these alone, as in Helix, whose `private` client
-- roles may not enter; it is not exposed, so USAGE opens no new route.
--
-- Three tables have RLS and no policy (lint 0008). `keep_alive` takes Helix's
-- service-role policy; `feedback_reports` and `list_invites` are reached
-- through definer functions alone, and a policy refusing client roles says so.
begin;

create schema definers;
revoke all on schema definers from public;
grant usage on schema definers to anon, authenticated, service_role;

alter function public.accept_list_invite(text, text, jsonb) set schema definers;
alter function public.answer_offer(uuid, boolean, text, jsonb) set schema definers;
alter function public.create_list_invite(uuid, text, text) set schema definers;
alter function public.delete_own_account() set schema definers;
alter function public.list_offers() set schema definers;
alter function public.offer_list(uuid, uuid, text, text) set schema definers;
alter function public.own_photo_objects() set schema definers;
alter function public.peek_list_invite(text) set schema definers;
alter function public.record_feedback_send() set schema definers;
alter function public.record_signed_out_feedback_send() set schema definers;
alter function public.unnamed_photos() set schema definers;

create function public.accept_list_invite(token text, member_name text, pantry jsonb default null)
returns uuid language sql security invoker set search_path = ''
as $$ select definers.accept_list_invite($1, $2, $3) $$;

create function public.answer_offer(list uuid, accept boolean, member_name text, pantry jsonb default null)
returns uuid language sql security invoker set search_path = ''
as $$ select definers.answer_offer($1, $2, $3, $4) $$;

create function public.create_list_invite(list uuid, invite_role text, owner_name text)
returns text language sql security invoker set search_path = ''
as $$ select definers.create_list_invite($1, $2, $3) $$;

create function public.delete_own_account()
returns void language sql security invoker set search_path = ''
as $$ select definers.delete_own_account() $$;

create function public.list_offers()
returns table (list_id uuid, list_name text, kind text, role text, from_name text, to_user uuid)
language sql stable security invoker set search_path = ''
as $$ select * from definers.list_offers() $$;

create function public.offer_list(list uuid, person uuid, role text, owner_name text)
returns void language sql security invoker set search_path = ''
as $$ select definers.offer_list($1, $2, $3, $4) $$;

create function public.own_photo_objects()
returns setof text language sql stable security invoker set search_path = ''
as $$ select definers.own_photo_objects() $$;

create function public.peek_list_invite(token text)
returns table (kind text, name text, inviter text)
language sql stable security invoker set search_path = ''
as $$ select * from definers.peek_list_invite($1) $$;

create function public.record_feedback_send()
returns boolean language sql security invoker set search_path = ''
as $$ select definers.record_feedback_send() $$;

create function public.record_signed_out_feedback_send()
returns boolean language sql security invoker set search_path = ''
as $$ select definers.record_signed_out_feedback_send() $$;

create function public.unnamed_photos()
returns setof text language sql stable security invoker set search_path = ''
as $$ select definers.unnamed_photos() $$;

revoke all on function public.accept_list_invite(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.answer_offer(uuid, boolean, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_list_invite(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;
revoke all on function public.list_offers() from public, anon, authenticated, service_role;
revoke all on function public.offer_list(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.own_photo_objects() from public, anon, authenticated, service_role;
revoke all on function public.peek_list_invite(text) from public, anon, authenticated, service_role;
revoke all on function public.record_feedback_send() from public, anon, authenticated, service_role;
revoke all on function public.record_signed_out_feedback_send() from public, anon, authenticated, service_role;
revoke all on function public.unnamed_photos() from public, anon, authenticated, service_role;

grant execute on function public.accept_list_invite(text, text, jsonb) to authenticated, service_role;
grant execute on function public.answer_offer(uuid, boolean, text, jsonb) to authenticated, service_role;
grant execute on function public.create_list_invite(uuid, text, text) to authenticated, service_role;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.list_offers() to authenticated, service_role;
grant execute on function public.offer_list(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.own_photo_objects() to authenticated;
grant execute on function public.peek_list_invite(text) to authenticated, service_role;
grant execute on function public.record_feedback_send() to authenticated, service_role;
grant execute on function public.record_signed_out_feedback_send() to anon, service_role;
grant execute on function public.unnamed_photos() to authenticated, service_role;

create policy keep_alive_service_role
  on public.keep_alive
  for all
  to service_role
  using (true)
  with check (true);

create policy feedback_reports_no_client
  on public.feedback_reports
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy list_invites_no_client
  on public.list_invites
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
