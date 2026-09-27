-- Feedback's send limit (SPEC 13.1), Helix's migration 37: `send-feedback`
-- mails the owner through one Gmail account, sign-up is open, and any account
-- could repeat a valid report until the account's quota was spent. The
-- function is a public endpoint, so the limit lives here, not in its memory.
--
-- `authenticated` holds nothing on the table: a caller cannot read its ledger,
-- forge an older row, or delete the rows counting against it. The function,
-- security definer and argument-free, is the only way in, and acts on
-- `auth.uid()` alone. Five an hour stops a burst, twenty a day a patient
-- sender. Count and insert are one call, so two requests in flight cannot
-- both read one count and both pass it; a third at the same instant can.

begin;

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  -- Goes with the account: nothing here outlives the person it counted.
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index feedback_reports_user_created on public.feedback_reports (user_id, created_at desc);

-- Enabled, and without policies: no client access is granted.
alter table public.feedback_reports enable row level security;

revoke all on table public.feedback_reports from public, anon, authenticated;
grant all on table public.feedback_reports to service_role;

-- True when the report may go out. A yes or a no: a count left would be one
-- more thing to tune an abuse against.
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
