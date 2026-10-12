-- The feedback limit, serialised per account.
--
-- Counting and inserting are a SELECT INTO and then an INSERT, and under READ
-- COMMITTED a second call cannot see the first's uncommitted row, so any number
-- of overlapping calls from one account could read the same count and all send.
-- A transaction-scoped advisory lock on the account makes the second call wait
-- for the first to commit and then count its row. It is per account, so one
-- sender never waits on another, and it ends with the transaction.

begin;

create or replace function public.record_feedback_send()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid := auth.uid();
  recent integer;
  today integer;
begin
  if account is null then
    return false;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('record_feedback_send:' || account::text, 0)
  );
  -- Past the wider window a row can never change an answer again.
  delete from public.feedback_reports
   where user_id = account
     and created_at < pg_catalog.now() - interval '1 day';

  select
    count(*) filter (where created_at > pg_catalog.now() - interval '1 hour'),
    count(*)
    into recent, today
    from public.feedback_reports
   where user_id = account;

  if recent >= 5 or today >= 20 then
    return false;
  end if;

  insert into public.feedback_reports (user_id) values (account);
  return true;
end $$;

revoke all on function public.record_feedback_send() from public, anon;
grant execute on function public.record_feedback_send() to authenticated;

commit;
