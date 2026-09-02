-- Migration: progress days on the Account calendar.
--
-- schema.sql uses `create table if not exists`, so re-running it against an
-- existing project does nothing. This adds the one column the calendar's
-- outline dots are drawn from.
--
-- RUN THIS BEFORE DEPLOYING THE MATCHING APP CHANGE. The app writes
-- progress_days every time you move a book, show or game along; if the
-- column doesn't exist yet, every one of those writes fails with "column
-- items.progress_days does not exist" and the progress control appears to
-- do nothing. Order matters here in a way it didn't for season_number,
-- which was nullable and only written by a new code path.
--
-- WHAT IT DOES
--   STEP 1 (required) adds progress_days: the local calendar days you made
--     progress on an item, 'YYYY-MM-DD', at most one entry per day. Empty
--     for every existing row — see "history" below.
--   STEP 2 (declined, commented out) would have seeded a single guessed
--     day for items you're currently partway through, so the calendar
--     wasn't completely bare on day one.
--
-- SAFE TO RE-RUN. Step 1 is guarded and defaults to an empty array, so it
-- cannot alter existing row data.
--
-- ABOUT HISTORY: nothing before today can be reconstructed. The app has
-- only ever stored the *current* progress value, and updated_at is
-- overwritten by any edit at all — a rating, a tag, a note. There is no
-- record of when you read chapter four, so none is invented. Past months
-- stay as they are, permanently; outline dots start accumulating from the
-- day this ships.
--
-- HOW TO RUN: Supabase → SQL Editor → New query. Step 1 is the only part
-- that executes — paste and run the whole file. Step 2 was declined and is
-- commented out; see its header.


-- ---------------------------------------------------------------------------
-- STEP 1 — add the column (required)
-- ---------------------------------------------------------------------------

alter table public.items
  add column if not exists progress_days text[] not null default '{}';


-- ---------------------------------------------------------------------------
-- VERIFY STEP 1 — expect one row: progress_days, ARRAY, NO (not nullable),
-- and every existing row holding an empty array.
-- ---------------------------------------------------------------------------

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'items' and column_name = 'progress_days';

select count(*) as rows_with_a_progress_day
from public.items
where cardinality(progress_days) > 0;


-- ---------------------------------------------------------------------------
-- STEP 2 — seed today's in-progress items (DECLINED — commented out)
--
-- Not run, on purpose: the calendar should only show days it can actually
-- vouch for, and this seeds days it can't. Left here intact rather than
-- deleted, so it stays available if that's ever revisited — uncommenting
-- it is then a deliberate act rather than the side effect of pasting the
-- file.
--
-- This is a guess, not a recovery. For an item you're currently partway
-- through, the last edit was *probably* progress — but it might equally
-- have been a tag change or a note. It seeds exactly one day per item, the
-- local day of updated_at, so at worst you get a handful of dots on days
-- you touched the item rather than days you watched or read it.
--
-- 'America/New_York' below is the timezone the days are computed in — set
-- it to yours, since updated_at is stored in UTC and an evening edit lands
-- on the following day if converted wrongly.
-- ---------------------------------------------------------------------------

-- 2a. PREVIEW — run this first and look at what it would write.
-- select id, title, media_type, updated_at,
--        to_char(updated_at at time zone 'America/New_York', 'YYYY-MM-DD') as would_seed
-- from public.items
-- where status = 'in_progress'
--   and cardinality(progress_days) = 0
-- order by updated_at desc;

-- 2b. RECORD what is about to be written, so the rollback below can be
-- exact. This is not optional bookkeeping: writing progress_days fires the
-- items_set_updated_at trigger, so after the apply step updated_at is the
-- migration's own timestamp and the seeded day can no longer be recomputed
-- from the row. Without this table, a rollback could only guess.
-- create table if not exists public.progress_days_seed as
-- select id,
--        array[to_char(updated_at at time zone 'America/New_York', 'YYYY-MM-DD')] as seeded
-- from public.items
-- where status = 'in_progress'
--   and cardinality(progress_days) = 0;

-- Everything in the public schema is reachable through PostgREST with the
-- anon key. This holds only ids and dates, but it belongs to one user and
-- has no policies of its own, so lock it to the SQL editor.
-- alter table public.progress_days_seed enable row level security;

-- 2c. APPLY — only after the preview looks right.
-- update public.items i
-- set progress_days = s.seeded
-- from public.progress_days_seed s
-- where i.id = s.id
--   and cardinality(i.progress_days) = 0;


-- ---------------------------------------------------------------------------
-- ROLLBACK for step 2 — reverses only rows still holding exactly what the
-- seed wrote. An item you've made real progress on since then has a
-- different array, so it is left alone rather than being wiped along with
-- the guess.
--
-- Uncomment to run, then drop the bookkeeping table.
-- ---------------------------------------------------------------------------

-- update public.items i
-- set progress_days = '{}'
-- from public.progress_days_seed s
-- where i.id = s.id and i.progress_days = s.seeded;
--
-- drop table public.progress_days_seed;


-- ---------------------------------------------------------------------------
-- CLEAN UP — once you're happy with step 2 and won't be reversing it.
-- ---------------------------------------------------------------------------

-- drop table public.progress_days_seed;
