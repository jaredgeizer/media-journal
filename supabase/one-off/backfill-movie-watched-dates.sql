-- One-off backfill: give completed movies a watched date from their release date.
--
-- Written for a library full of Letterboxd-imported films that have a release
-- date but no per-item watch date, which makes "Clean up Journal" ask about
-- every single one. This sets date_completed = release_date in bulk instead.
--
-- WHAT IT TOUCHES
--   - media_type = 'movie'
--   - status = 'completed'          <- deliberately NOT backlog/in-progress:
--                                      those genuinely haven't been watched,
--                                      and inventing a watch date for them
--                                      would distort the Journal and any
--                                      yearly goals counting completed movies
--   - date_completed is null        <- never overwrites a real date you set
--   - release_date is usable        <- rows with no release date are skipped
--                                      (nothing to derive a date from)
--
-- PARTIAL RELEASE DATES
--   release_date is a text column and can hold a full date, a month, or a
--   bare year depending on the source (see the column comment in schema.sql).
--   Partial values round down to the 1st: '1999' -> 1999-01-01,
--   '1999-10' -> 1999-10-01.
--
-- WHY NOON AND NOT MIDNIGHT
--   date_completed is timestamptz, and the app renders it with
--   toLocaleDateString() in the *viewer's local* timezone (journalEntryHtml()
--   in js/app.js). This script runs server-side with no idea what timezone
--   you're in, so storing midnight UTC would display as the previous day for
--   anyone west of UTC -- verified: '2021-10-22T00:00:00Z' renders as
--   "Oct 21, 2021" in every US timezone. Noon UTC renders as the intended
--   calendar date from UTC-12 through UTC+11, which covers the Americas,
--   Europe, Africa and most of Asia.
--
--   The one gap: UTC+12 and further east (New Zealand, Fiji, Samoa) would
--   see the day *after* the intended date. If this library ever moves to a
--   timezone that far east, change '12:00:00+00' below to '00:00:00+00' and
--   the tradeoff flips. There is no single instant correct for every zone --
--   UTC-12 to UTC+14 spans 26 hours, so some choice has to be made.
--
-- BEFORE RUNNING: export a JSON backup from the app (account menu ->
-- Import / Export -> Export). This rewrites rows in place and there is no
-- undo beyond the rollback query at the bottom.
--
-- HOW TO RUN — read this, it matters
--   Supabase's SQL editor runs EVERY statement in the editor box when you
--   hit Run. Pasting this whole file and clicking Run would fire the preview
--   and the update together, which defeats the point of having a preview.
--
--   Run one numbered step at a time, either by:
--     (a) pasting just that step's block into an empty editor, or
--     (b) pasting the whole file, then selecting only that step's text and
--         pressing Cmd+Enter (Ctrl+Enter on Windows) to run the selection.
--
-- Project -> SQL Editor -> New query.
-- Replace the email below if this is ever used for a different account.


-- ---------------------------------------------------------------------------
-- STEP 1 — PREVIEW. Run this alone first and read the output.
-- Changes nothing. Shows exactly which movies would be touched and what
-- watched date each would get.
-- ---------------------------------------------------------------------------

with target as (
  select
    id,
    title,
    year,
    release_date,
    case
      when release_date ~ '^\d{4}-\d{2}-\d{2}' then left(release_date, 10)
      when release_date ~ '^\d{4}-\d{2}$'      then release_date || '-01'
      when release_date ~ '^\d{4}$'            then release_date || '-01-01'
    end as resolved_date
  from public.items
  where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
    and media_type = 'movie'
    and status = 'completed'
    and date_completed is null
)
select
  title,
  year,
  release_date as stored_release_date,
  resolved_date as would_set_watched_date,
  case
    when release_date ~ '^\d{4}-\d{2}-\d{2}' then 'exact date'
    when release_date ~ '^\d{4}-\d{2}$'      then 'month only, rounded to 1st'
    when release_date ~ '^\d{4}$'            then 'year only, rounded to Jan 1'
    when release_date is null                then 'SKIPPED - no release date'
    else                                          'SKIPPED - unrecognized format'
  end as note
from target
order by resolved_date nulls last, title;


-- ---------------------------------------------------------------------------
-- STEP 2 — THE UPDATE. Only run this once the preview above looks right.
-- Reports how many rows it changed.
-- ---------------------------------------------------------------------------

with target as (
  select
    id,
    case
      when release_date ~ '^\d{4}-\d{2}-\d{2}' then left(release_date, 10)
      when release_date ~ '^\d{4}-\d{2}$'      then release_date || '-01'
      when release_date ~ '^\d{4}$'            then release_date || '-01-01'
    end as resolved_date
  from public.items
  where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
    and media_type = 'movie'
    and status = 'completed'
    and date_completed is null
)
update public.items i
set date_completed = (t.resolved_date || ' 12:00:00+00')::timestamptz
from target t
where i.id = t.id
  and t.resolved_date is not null;


-- ---------------------------------------------------------------------------
-- STEP 3 — VERIFY. Optional. Should return 0 rows with a usable release date;
-- anything left is a movie with no release date to work from.
-- ---------------------------------------------------------------------------

select title, year, release_date
from public.items
where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
  and media_type = 'movie'
  and status = 'completed'
  and date_completed is null
order by title;


-- ---------------------------------------------------------------------------
-- ROLLBACK — only if step 2 went wrong. Uncomment to use.
--
-- This clears date_completed ONLY on rows whose value is exactly what step 2
-- would have written (the derived release date at noon UTC). Anything else --
-- a date you set by hand, or one this script deliberately skipped -- fails
-- the equality check and is left alone.
--
-- Do NOT be tempted to roll back by updated_at window instead. That looks
-- simpler and is wrong: it clears any completed movie touched in that window,
-- including ones with real watched dates the backfill never modified. Tested,
-- and it destroyed a hand-set date.
-- ---------------------------------------------------------------------------

-- with target as (
--   select
--     id,
--     case
--       when release_date ~ '^\d{4}-\d{2}-\d{2}' then left(release_date, 10)
--       when release_date ~ '^\d{4}-\d{2}$'      then release_date || '-01'
--       when release_date ~ '^\d{4}$'            then release_date || '-01-01'
--     end as resolved_date
--   from public.items
--   where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
--     and media_type = 'movie'
--     and status = 'completed'
-- )
-- update public.items i
-- set date_completed = null
-- from target t
-- where i.id = t.id
--   and t.resolved_date is not null
--   and i.date_completed = (t.resolved_date || ' 12:00:00+00')::timestamptz;
