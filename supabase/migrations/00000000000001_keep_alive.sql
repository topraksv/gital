-- The free plan pauses a project after about seven days without traffic, and
-- the app may go unopened for longer than that. `.github/workflows/keepalive.yml`
-- upserts and reads this one row every three days with the service-role key.
-- It is not user data and has no owner column, so no client role may touch it:
-- RLS with no policy, and every grant revoked from anon and authenticated.
-- Helix's heartbeat, ported as it stands.

create table public.keep_alive (
  id int primary key,
  pinged_at timestamptz not null default now()
);

alter table public.keep_alive enable row level security;

revoke all on table public.keep_alive from anon, authenticated;
grant all on table public.keep_alive to service_role;
