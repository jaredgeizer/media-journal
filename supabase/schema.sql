-- Media Journal — Supabase schema
-- Run this once in your Supabase project's SQL editor (Project → SQL Editor → New query).

create extension if not exists "pgcrypto";

create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,

  -- what it is
  media_type     text not null check (media_type in ('movie', 'tv', 'book', 'podcast', 'album', 'game', 'play', 'restaurant', 'other')),
  title          text not null,
  creator        text,        -- director / author / host / artist / etc.
  year           text,
  poster_url     text,
  description    text,

  -- where it came from (for search results pulled from an external API)
  external_source text,       -- 'tmdb' | 'google_books' | 'itunes' | 'musicbrainz' | 'igdb' | 'rawg' (legacy) | 'manual'
  external_id     text,
  external_url    text,       -- link to the source page (e.g. Apple Podcasts, Google Books)

  -- journal state
  --
  -- 'ended' is for TV show *containers* only: a series you've finished,
  -- where the seasons you watched are recorded as their own completed
  -- entries (see season_number below). It is deliberately NOT 'completed'
  -- — 'completed' is what puts an item in the Journal and counts it in
  -- every statistic, and a container should do neither. Keeping
  -- containers out of that status means all the existing
  -- `status = 'completed'` checks keep working untouched rather than each
  -- needing its own "...unless it's a TV container" exception.
  --
  -- The invariant to preserve: a TV container is never 'completed'.
  -- (TV rows predating per-season tracking are the exception — they stay
  -- as show-level completed entries, since there's no way to know which
  -- seasons they covered.)
  status         text not null default 'wishlist' check (status in ('wishlist', 'in_progress', 'completed', 'ended')),
  rating         smallint check (rating between 1 and 5),
  notes          text,
  tags           text[] not null default '{}',

  -- Which season this row records, for TV rows emitted when a season is
  -- finished. NULL means "not a season entry": every non-TV item, every
  -- show container, and legacy show-level TV entries. A season entry
  -- carries its own rating, notes and date_completed, and its external_id
  -- is suffixed (e.g. 'tv-1399-s2') so matchesLibraryItem() doesn't fold
  -- every season of a show into one item.
  season_number  smallint check (season_number > 0),

  -- progress tracking (books, video games & TV shows only, while status = 'in_progress')
  progress_percent smallint check (progress_percent between 0 and 100),  -- books & video games
  progress_season   smallint,                                            -- TV shows
  progress_episode  smallint,                                            -- TV shows

  -- release date and notification-log bookkeeping: each *_at column is
  -- set once, the first time that notification fires for this item, so
  -- it never repeats. notified_release_soon_days freezes how many days
  -- were left at that moment, since the countdown itself keeps moving
  -- but the notification text shouldn't change after the fact.
  --
  -- release_date is `text`, not `date` — some sources (Google Books,
  -- MusicBrainz) only give a partial date for less-cataloged entries
  -- (e.g. "2021-10", year-month with no day), which a real `date` column
  -- rejects outright ("invalid input syntax for type date"). The app
  -- already treats this field as a loosely-formatted string everywhere
  -- (hasReleaseMonth(), modalDateLabel(), dateInputValue() in js/app.js)
  -- rather than relying on Postgres date validation/arithmetic, so a
  -- plain text column matches how it's actually used.
  release_date               text,
  -- Set whenever Clean Up searches for a release date and finds nothing
  -- more precise than what's already stored (e.g. an unreleased title
  -- with only a bare year known) — lets it stop re-suggesting a "fix"
  -- that wouldn't actually change anything, then quietly check again
  -- later. See RELEASE_DATE_RECHECK_DAYS in js/app.js.
  release_date_checked_at    timestamptz,
  notified_season_at         timestamptz,
  notified_release_soon_at   timestamptz,
  notified_release_soon_days smallint,
  notified_release_day_at    timestamptz,
  notified_stale_progress_at timestamptz,

  date_added     timestamptz not null default now(),
  date_completed timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists items_user_id_idx on public.items (user_id);
create index if not exists items_status_idx on public.items (user_id, status);
create index if not exists items_media_type_idx on public.items (user_id, media_type);

-- keep updated_at current
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- Row Level Security: every user can only ever see/touch their own rows.
alter table public.items enable row level security;

drop policy if exists "Users can view their own items" on public.items;
create policy "Users can view their own items"
  on public.items for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own items" on public.items;
create policy "Users can insert their own items"
  on public.items for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own items" on public.items;
create policy "Users can update their own items"
  on public.items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own items" on public.items;
create policy "Users can delete their own items"
  on public.items for delete
  using (auth.uid() = user_id);

-- Yearly goals. Two kinds of row share this table:
--   - The constant reading goal: media_type = 'book', media_types = null.
--     One per user/year (enforced by the unique constraint below — Postgres
--     treats NULL media_type as distinct across rows, so it never collides
--     with the custom goals underneath).
--   - User-defined custom goals: media_type = null, media_types = a
--     non-empty array of the media types that count toward it (e.g.
--     ['movie', 'tv']). Any number per user/year, identified by id.
-- Progress itself isn't stored here; the app derives it from items (count of
-- the matching media type(s) completed in that year) every time it renders.
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  year        smallint not null,
  media_type  text,
  media_types text[],
  target      smallint not null check (target > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint goals_media_type_xor check ((media_type is not null) <> (media_types is not null)),
  unique (user_id, year, media_type)
);

create index if not exists goals_user_id_idx on public.goals (user_id);

drop trigger if exists goals_set_updated_at on public.goals;
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

alter table public.goals enable row level security;

drop policy if exists "Users can view their own goals" on public.goals;
create policy "Users can view their own goals"
  on public.goals for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own goals" on public.goals;
create policy "Users can insert their own goals"
  on public.goals for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own goals" on public.goals;
create policy "Users can update their own goals"
  on public.goals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own goals" on public.goals;
create policy "Users can delete their own goals"
  on public.goals for delete
  using (auth.uid() = user_id);

-- Libby has no library-agnostic deep link — every search URL is scoped to
-- a specific library from the start — so a book's "Find on Libby" link
-- (Backlog item modal) needs the user's home library code saved here
-- first (Account → Import/Export → "Libby"). Purely a client-side lookup,
-- no Edge Function involved.
create table if not exists public.libby_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  library_code text not null,
  updated_at   timestamptz not null default now()
);

alter table public.libby_settings enable row level security;

drop policy if exists "Users can view their own libby settings" on public.libby_settings;
create policy "Users can view their own libby settings"
  on public.libby_settings for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own libby settings" on public.libby_settings;
create policy "Users can insert their own libby settings"
  on public.libby_settings for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own libby settings" on public.libby_settings;
create policy "Users can update their own libby settings"
  on public.libby_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own libby settings" on public.libby_settings;
create policy "Users can delete their own libby settings"
  on public.libby_settings for delete
  using (auth.uid() = user_id);
