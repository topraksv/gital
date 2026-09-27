-- An account deletes itself (SPEC 9.1), Helix's function in its hardened form
-- (Helix 0003, then 0015). The identity lives in auth.users, which only an
-- admin may delete from; a SECURITY DEFINER function with no argument lets a
-- signed-in user remove their own row and no other, without the service-role
-- key ever reaching the app. Gital keeps no cloud rows yet; when sync adds
-- them, each owner column references auth.users on delete cascade, so this one
-- delete takes them in the same transaction.

create or replace function public.delete_own_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

-- Owner and search path pinned, so nothing the caller controls resolves a name.
alter function public.delete_own_account() owner to postgres;
revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;
grant execute on function public.delete_own_account() to authenticated;
