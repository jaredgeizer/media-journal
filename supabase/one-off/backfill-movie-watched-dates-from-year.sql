-- One-off backfill, part 2: watched dates from the `year` column.
--
-- Companion to backfill-movie-watched-dates.sql. That script derives a
-- watched date from release_date; this one picks up what it couldn't -- the
-- movies with no usable release_date at all, but which do have a bare year.
--
-- ORDER DOESN'T MATTER. This deliberately only touches rows whose
-- release_date is unusable, so running it before or after the release_date
-- script gives the same result. It will never use a year when a real release
-- date was available.
--
-- THIS IS THE COARSER OF THE TWO. Every row it touches gets January 1 of its
-- year, because that is genuinely all the information there is. If you would
-- rather those films simply keep no watched date than carry a made-up
-- January 1, don't run this -- the first script is the accurate one and this
-- is the mop-up.
--
-- WHAT IT TOUCHES
--   - media_type = 'movie'
--   - status = 'completed'          <- not backlog/in-progress, same as part 1
--   - date_completed is null        <- never overwrites a real date
--   - release_date unusable         <- null, or not starting with 4 digits;
--                                      anything usable belongs to part 1
--   - year looks like a real year   <- matches ^\d{4}$, so junk is skipped
--
-- Noon UTC, for the same timezone reason documented at length in part 1:
-- date_completed renders in the viewer's local timezone, so midnight UTC
-- would display as December 31 of the previous year for anyone west of UTC.
--
-- BEFORE RUNNING: export a JSON backup from the app (account menu ->
-- Import / Export -> Export).
--
-- HOW TO RUN — same as part 1: Supabase's SQL editor runs EVERY statement in
-- the box when you hit Run, so run one numbered step at a time. Either paste
-- a single step into an empty editor, or paste the whole file and select just
-- that step's text and press Cmd+Enter (Ctrl+Enter on Windows).
--
-- Project -> SQL Editor -> New query.


-- ---------------------------------------------------------------------------
-- STEP 1 — PREVIEW. Run this alone first. Changes nothing.
-- ---------------------------------------------------------------------------

select
  title,
  year,
  release_date as stored_release_date,
  year || '-01-01' as would_set_watched_date,
  'year only, no usable release date' as note
from public.items
where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
  and media_type = 'movie'
  and status = 'completed'
  and date_completed is null
  and (release_date is null or release_date !~ '^\d{4}')
  and year ~ '^\d{4}$'
order by year, title;


-- ---------------------------------------------------------------------------
-- STEP 2 — THE UPDATE. Only after the preview looks right.
-- ---------------------------------------------------------------------------

update public.items
set date_completed = (year || '-01-01 12:00:00+00')::timestamptz
where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
  and media_type = 'movie'
  and status = 'completed'
  and date_completed is null
  and (release_date is null or release_date !~ '^\d{4}')
  and year ~ '^\d{4}$';


-- ---------------------------------------------------------------------------
-- STEP 3 — VERIFY. What's still missing a watched date after both scripts.
-- Anything listed here has neither a usable release date nor a usable year,
-- and can only be fixed by hand (or left alone).
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
-- Clears date_completed ONLY where it exactly equals January 1 noon UTC of
-- that row's own year -- i.e. exactly what step 2 writes. A date you set by
-- hand fails that check and is left alone.
--
-- Note the release_date condition on the last line. It is not redundant with
-- the value check, and removing it causes real data loss: when release_date
-- is a bare year equal to the `year` column, part 1 writes the exact same
-- value this script would, so matching on value alone also reverses part 1's
-- work. Tested -- without that line this cleared a date part 1 had written.
--
-- As in part 1: do not roll back by updated_at window either. It looks
-- simpler and it clears watched dates this script never wrote.
-- ---------------------------------------------------------------------------

-- update public.items
-- set date_completed = null
-- where user_id = (select id from auth.users where email = 'jaredg555@gmail.com')
--   and media_type = 'movie'
--   and status = 'completed'
--   and year ~ '^\d{4}$'
--   and date_completed = (year || '-01-01 12:00:00+00')::timestamptz
--   and (release_date is null or release_date !~ '^\d{4}');
