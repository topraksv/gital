-- Kiler sorts as a list does, by its grips (the owner asked 2026-09-27): a
-- product's place, 0 until it is first dragged, so an arrival lands on top.
-- A default rather than a backfill, since every row's place is 0 until then.
alter table public.pantry_items
  add column sort_order bigint not null default 0;
