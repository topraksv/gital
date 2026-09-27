-- A device pushes a new list as PostgREST upserts it: an insert that returns
-- the row, so the row must pass the select policy in the statement that
-- inserts it. Migration 5 made that policy `can_read_list(id)`, whose lookup
-- of `lists` runs on the statement's snapshot and cannot see the row being
-- inserted, so every new list was refused (42501) from then on, and an
-- invitation to it answered "not the owner" because the server never had it.
-- The owner's own row is now recognised on the row itself, as migration 3
-- did, before the lookup that serves members.

drop policy lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_read_list(id));
