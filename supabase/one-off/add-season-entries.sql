-- Migration: per-season TV completion.
--
-- schema.sql uses `create table if not exists`, so re-running it against an
-- existing project does nothing. This applies the two structural changes
-- that per-season TV tracking needs.
--
-- WHAT IT DOES
--   1. Widens the status CHECK to allow 'ended' — the status a finished TV
--      show *container* takes. Deliberately not 'completed': that status is
--      what puts a row in the Journal and counts it in every statistic, and
--      a container should do neither. See the comment in schema.sql.
--   2. Adds season_number, the marker for a row that records one season.
--      NULL means "not a season entry" — every non-TV item, every show
--      container, and every legacy show-level TV entry.
--
-- SAFE TO RE-RUN. Both steps are guarded, and neither touches existing row
-- data: season_number defaults to NULL everywhere, and widening a CHECK
-- constraint cannot invalidate rows that already satisfy the narrower one.
--
-- Nothing is migrated. TV rows finished before this change stay exactly as
-- they are — show-level completed entries with a NULL season_number. There
-- is no way to know which seasons an old entry actually covered, so nothing
-- is invented.
--
-- HOW TO RUN: Supabase → SQL Editor → New query. This one is short enough
-- to paste and run in a single go, unlike the backfill scripts in this
-- folder that are split into preview/apply steps.


-- ---------------------------------------------------------------------------
-- STEP 1 — allow the 'ended' status
-- ---------------------------------------------------------------------------

alter table public.items drop constraint if exists items_status_check;

alter table public.items
  add constraint items_status_check
  check (status in ('wishlist', 'in_progress', 'completed', 'ended'));


-- ---------------------------------------------------------------------------
-- STEP 2 — add the season marker
-- ---------------------------------------------------------------------------

alter table public.items
  add column if not exists season_number smallint;

alter table public.items drop constraint if exists items_season_number_check;

alter table public.items
  add constraint items_season_number_check
  check (season_number is null or season_number > 0);


-- ---------------------------------------------------------------------------
-- VERIFY — run after the two steps above.
-- Expect: status_check listing four statuses, a season_number column of type
-- smallint that is nullable, and every existing row still NULL on it.
-- ---------------------------------------------------------------------------

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.items'::regclass
  and conname in ('items_status_check', 'items_season_number_check');

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'items' and column_name = 'season_number';

select count(*) as rows_with_a_season_number
from public.items
where season_number is not null;
