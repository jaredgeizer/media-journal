# Media Journal

A personal media journal / blog: track what you want to watch, read, or
listen to, and log what you've finished with a rating and notes. Built as
plain HTML/CSS/JS with a "liquid glass" (frosted, translucent) design,
so it hosts anywhere as static files and works well on phone, tablet, and
desktop.

## How it works

- **Backlog** — things you want to watch/read/listen to eventually.
- **Journal** — a blog-style feed of things you've finished, with your
  star rating and notes, newest first.
- **Discover** — search movies & TV (TMDb), books (Google Books),
  podcasts (iTunes), albums (MusicBrainz), and video games (IGDB) and add
  results with one tap. Anything else (plays, restaurants, etc.) can be
  added by hand.

Clicking any item opens a modal with a **Mark as Watched/Read** button
(everything except that lives in a second "review" step). That review
modal has no Save button — the star rating and tags save the instant you
tap them, and notes save automatically when you click away from the
textarea. An already-reviewed item shows its rating/tags/notes as a
summary with **Edit Review** and **Move back to Backlog/Currently**
actions. Both Backlog and Journal have their own search/filter bar with
tappable chips to narrow by media type.

Items can be tagged: backlog items get a single **⭐ Shortlist** tag to
flag your top picks. In the review modal you can multi-select tags —
**Favorite** is always offered, and beyond that tags are entirely
user-defined: type a new one to create it, and it becomes a suggested
chip for other items of that same media type going forward. Tags are
searchable in the filter bar, and the Journal has a dedicated Tags
filter (multi-select dropdown of every tag you've used).

From Discover, adding a result gives three options: **Add to Backlog**,
**Mark as Watched/Read** (creates the item and opens the review modal),
or — for books, video games, and TV shows only — **Currently
Reading/Watching/Playing**, which files it at the top of the Journal
with editable progress (percent-complete for books & games, season/
episode for TV — TV cards also get a one-tap **Next Episode** button)
until you mark it watched/read, which moves it into the journal feed
below.

The 🔔 bell next to the account icon surfaces two kinds of updates,
checked once per app load: a TV show you finished moves back to Backlog
(rating/notes kept) once a new season airs, and a Backlog movie gets a
heads-up once (7 days out, whatever the actual countdown is by the time
you next open the app) and again on/shortly after release day. The 5 most
recent notifications stay listed even after you've seen them — opening
the bell just clears the unread dot. Tapping one opens that item.

The account icon's **Account** page shows a year picker with your
totals per media type for that year (or **All Years**), a visual
breakdown as a pie chart, and a yearly reading goal — set how many
books you want to read, and the progress bar fills in automatically
from books you've marked read that year, including ones you'd already
logged before setting the goal. Starting 3 weeks before January 1st,
you can also set next year's goal ahead of time.

## Running it locally (Demo Mode)

No setup required. Just serve the folder and open it in a browser:

```
cd media-journal
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. With no Supabase config, the app runs
in **Demo Mode**: your data is saved to `localStorage` in that one
browser only. It's a good way to try the UI before setting up real
storage. Book, podcast, and album search work in Demo Mode too (no key
needed); movie/TV search needs a TMDb key. Video game search needs a
connected Supabase project either way — see below, it doesn't work in
Demo Mode at all (IGDB's API can only be reached through a server-side
proxy, not directly from the browser).

## Setting up real storage (Supabase) — for cross-device sync

To access your journal from your phone, tablet, and computer, connect a
free [Supabase](https://supabase.com) project. Supabase gives you a
hosted Postgres database plus login, and the site talks to it directly
from the browser — no server of your own to run.

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** in your project, paste in the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. This creates
   the `items` table and locks it down with Row Level Security so only
   you can ever read or write your own rows.
3. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.
4. Open `js/config.js` and fill in `supabaseUrl` and `supabaseAnonKey`.
5. Reload the site — you'll be sent to a sign-in screen. Click **Sign
   up**, create an account with your email/password, confirm via the
   email Supabase sends, then sign in.

That's it — items you add will now sync everywhere you sign in.

> The Supabase `anon` key is meant to be public (that's how Supabase's
> client-side auth model works) — your data is protected by the Row
> Level Security policies in `schema.sql`, not by keeping this key
> secret. It's safe to commit `js/config.js` with real values.

### Updating an existing Supabase project

If you already ran `schema.sql` once and the file has since gained new
columns, don't re-run the whole thing — it's safe to (the `create table
if not exists` and `drop policy if exists` guards make it idempotent),
but the simplest fix is to run just the new column(s). Currently:

```sql
alter table public.items add column if not exists external_url text;
alter table public.items add column if not exists tags text[] not null default '{}';
alter table public.items add column if not exists progress_percent smallint check (progress_percent between 0 and 100);
alter table public.items add column if not exists progress_season smallint;
alter table public.items add column if not exists progress_episode smallint;
alter table public.items drop constraint if exists items_status_check;
alter table public.items add constraint items_status_check check (status in ('wishlist', 'in_progress', 'completed'));
alter table public.items drop constraint if exists items_media_type_check;
alter table public.items add constraint items_media_type_check check (media_type in ('movie', 'tv', 'book', 'podcast', 'album', 'game', 'play', 'restaurant', 'other'));
alter table public.items add column if not exists release_date text;
alter table public.items add column if not exists notified_season_at timestamptz;
alter table public.items add column if not exists notified_release_soon_at timestamptz;
alter table public.items add column if not exists notified_release_soon_days smallint;
alter table public.items add column if not exists notified_release_day_at timestamptz;
alter table public.items add column if not exists notified_stale_progress_at timestamptz;
alter table public.items add column if not exists release_date_checked_at timestamptz;
alter table public.items alter column release_date type text using release_date::text;
```

That last line matters even if you already had `release_date` — it was
originally a `date` column, which rejects a partial date like `"2021-10"`
(year-month, no day) with `invalid input syntax for type date`. Some
sources (Google Books, MusicBrainz) only ever have a partial date for
less-cataloged entries, so this shows up as a real "add to Backlog"
failure for certain books/albums. Widening the column to `text` (already
how the app treats this field everywhere client-side) fixes it — safe to
run even if the column's already `text`.

There's also a `goals` table (used by the Account page's yearly goals) —
this one's a separate block since it creates a whole table rather than
altering `items`. Safe to run on its own, any time, regardless of which
of the `items` statements above you've already run:

```sql
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
create policy "Users can view their own goals" on public.goals for select using (auth.uid() = user_id);
drop policy if exists "Users can insert their own goals" on public.goals;
create policy "Users can insert their own goals" on public.goals for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their own goals" on public.goals;
create policy "Users can update their own goals" on public.goals for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own goals" on public.goals;
create policy "Users can delete their own goals" on public.goals for delete using (auth.uid() = user_id);
```

If you already had the `goals` table from before custom (multi-media-type)
goals existed, it was created with `media_type text not null` and no
`media_types` column — run this to bring it up to date:

```sql
alter table public.goals alter column media_type drop not null;
alter table public.goals add column if not exists media_types text[];
alter table public.goals drop constraint if exists goals_media_type_xor;
alter table public.goals add constraint goals_media_type_xor check ((media_type is not null) <> (media_types is not null));
```

There's also a `libby_settings` table, used by the [Libby link on Backlog
books](#importing-your-data) — likewise safe to run on its own, any time:

```sql
create table if not exists public.libby_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  library_code text not null,
  updated_at   timestamptz not null default now()
);
alter table public.libby_settings enable row level security;
drop policy if exists "Users can view their own libby settings" on public.libby_settings;
create policy "Users can view their own libby settings" on public.libby_settings for select using (auth.uid() = user_id);
drop policy if exists "Users can insert their own libby settings" on public.libby_settings;
create policy "Users can insert their own libby settings" on public.libby_settings for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their own libby settings" on public.libby_settings;
create policy "Users can update their own libby settings" on public.libby_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users can delete their own libby settings" on public.libby_settings;
create policy "Users can delete their own libby settings" on public.libby_settings for delete using (auth.uid() = user_id);
```

## Setting up movie & TV search (TMDb)

1. Create a free account at [themoviedb.org](https://www.themoviedb.org).
2. Go to **Settings → API**, request a free API key, then copy the
   **API Read Access Token (v4 auth)**.
3. Paste it into `tmdbAccessToken` in `js/config.js`.

Podcast search (iTunes Search API) needs no key and works out of the box.
Album search (MusicBrainz) also needs no key and works out of the box.

## Setting up book search (Google Books)

Book search works with no key, but unkeyed requests share a small global
quota with everyone else doing the same — you'll occasionally see
`Book search failed (429)`. A free key gives you your own quota:

1. Go to [console.cloud.google.com](https://console.cloud.google.com),
   create or select a project.
2. **APIs & Services → Library** → search for and enable **Books API**.
3. **APIs & Services → Credentials → Create Credentials → API key**,
   then copy it.
4. Recommended: click into the new key and restrict it — under **API
   restrictions** limit it to the Books API, and under **Application
   restrictions** add your GitHub Pages URL as an allowed HTTP referrer
   (e.g. `https://<your-username>.github.io/*`) so it can't be used from
   anywhere else if someone finds it in your published JS.
5. Paste it into `googleBooksApiKey` in `js/config.js`.

## Setting up video game search (IGDB)

IGDB's API doesn't send CORS headers for arbitrary origins, so it can't
be called directly from the browser the way TMDb/Google Books/iTunes/
MusicBrainz are — a request straight to `api.igdb.com` from this app's JS
gets blocked by the browser itself. A small Supabase Edge Function sits
in front of it instead, making the request server-side. This means video
game search needs a connected Supabase project (see "Setting up real
storage" above) — it doesn't work in Demo Mode.

IGDB is owned by Twitch, so its credentials are Twitch app credentials:

1. Go to the [Twitch developer console](https://dev.twitch.tv/console/apps),
   register a new application (any name; category "Application
   Integration"), then copy its **Client ID** and generate a **Client
   Secret**.

   For the **OAuth Redirect URL**, use `https://localhost`. The console
   rejects `http://` URLs ("Redirect URIs must use HTTPS protocol") even
   though Twitch's own docs still suggest `http://localhost:3000`. It
   doesn't matter what you put: the redirect URL is only used in flows
   where a user is bounced to Twitch to log in and sent back, and this
   function uses the client-credentials grant instead — a direct
   server-to-server exchange of client id/secret for an app token, with
   no browser redirect anywhere in it. It's a required registration
   field that nothing here ever reads.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli) and
   log in, then from the repo root:
   ```sh
   supabase link --project-ref <your-project-ref>
   supabase functions deploy igdb-search
   supabase secrets set IGDB_CLIENT_ID=<your client id>
   supabase secrets set IGDB_CLIENT_SECRET=<your client secret>
   ```
   (Your project ref is the subdomain in your Supabase URL —
   `https://<project-ref>.supabase.co`.)

The function exchanges those credentials for a Twitch access token itself
and caches it, so there's nothing to refresh by hand. Free for
non-commercial use, rate limited to 4 requests/second — far more than
personal use needs. The footer already includes a "Game data from IGDB"
credit line.

> **Note on the deployed URL:** the function is currently deployed under
> the slug `super-task` rather than `igdb-search` — Supabase's dashboard
> "Deploy via Editor" flow assigns an internal slug from the starter
> template that's separate from the display name. `js/search.js` calls the
> real URL. If you redeploy via the CLI as above, the slug will match the
> directory name and that call needs updating to `/functions/v1/igdb-search`.

### Previously: RAWG

Game search used [RAWG](https://rawg.io) until August 2026. It was
dropped after repeated multi-day outages (9 in a single 30-day window on
its own status history) plus widely reported response times over 10
seconds even when up. Games already saved from RAWG keep working —
they're matched by title against new IGDB results, so nothing needs
re-adding.

## Importing your data

Under the account menu (👤 in the header) → **Import / Export**, you can:

- **Export** your whole library as a JSON file (also doubles as a backup).
- **Import from Goodreads**: export your library at
  [goodreads.com/review/import](https://www.goodreads.com/review/import) →
  "Export Library", then upload the `.csv` file. Shelves map to status
  (`read` → completed, `currently-reading` → in progress, `to-read` →
  backlog) and your 1–5 star rating carries over.
- **Import from Fable**: Fable has no official export. Use a third-party
  browser extension (e.g. "Fable Xport") to generate a Goodreads-style
  `.csv`, then upload it the same way as a Goodreads file.
- **Import from Letterboxd**: export your data at
  [letterboxd.com/user/exportdata](https://letterboxd.com/user/exportdata/)
  and upload the `.zip` as-is — no need to unzip it first. Letterboxd's
  half-star ratings (0.5–5) are rounded to the nearest whole star to fit
  this app's 1–5 scale.
- **Libby**: save your library's short code (found in the Libby app under
  your library card, or in the URL when you search on
  [libbyapp.com](https://libbyapp.com)) and a "Find on Libby" link shows
  up on backlog books, jumping straight to a search for that title at
  your library. Works in Demo Mode too — no server setup needed.

Every import shows a preview (how many items will be added vs. skipped as
already-in-your-library duplicates) before anything is written. Imported
items don't get poster images or descriptions automatically — use the
account menu's **Clean up Journal** / **Clean up Backlog** to auto-match and
backfill posters in bulk, or open an individual item and tap **Update Info**
to search and pick the right match yourself.

Serializd isn't supported yet — it doesn't currently offer a reliable free
export.

## Quick Add (Apple Shortcuts)

`quick-add.html` is a tiny standalone page for fast capture: an
already-focused title field plus **Shortlist**/**Recommended** tag chips
(Recommended is selected by default). Type a title and hit Return — no
search, just an instant add to your Backlog with placeholder details you
fill in later. It's also linked from the account menu (👤 → **Quick Add**)
for use inside the app itself.

To trigger it from an iPhone/iPad:

1. Open the **Shortcuts** app → **+** → add an **Open URLs** action, and set
   the URL to `https://<your-domain>/quick-add.html`.
2. Name the shortcut something like "Add to Backlog" and add it to your Home
   Screen, the Action Button, or Siri — however you'd like to trigger it.

Once an item is added, open it from the Backlog and tap **Update Info**
(shown whenever a backlog item has no poster yet) to jump into Discover with
the title pre-searched across every media type — tap the right result and it
fills in the card's poster, description, year, and type in place.

## Deploying to GitHub Pages

1. Fill in `js/config.js` as above and commit it (see the note on the
   anon key above — it's fine to publish).
2. Push this repo to GitHub.
3. In the repo, go to **Settings → Pages**, set **Source** to the branch
   you pushed (e.g. `main`) and folder `/ (root)`.
4. Your site will be live at `https://<your-username>.github.io/<repo>/`
   within a minute or two.

Because everything is static files, any other static host (Netlify,
Vercel, Cloudflare Pages, etc.) works the same way — just point it at
this folder.

## Adding restaurants (later)

The data model already supports a `restaurant` media type — there's just
no search hooked up yet (that needs a paid API like Google Places or
Yelp Fusion). For now you can add restaurants manually via **+ Add
manually** in the Discover tab; wiring up real restaurant search is a
natural next step.

## Project structure

```
index.html          Main app (Backlog / Journal / Discover)
login.html           Sign in / sign up (Supabase mode only)
quick-add.html        Standalone fast-capture page (Apple Shortcuts, etc.)
css/style.css        Liquid-glass design system
js/config.js          Your Supabase + API keys (fill in, safe to commit)
js/storage.js         Data layer: Supabase, or localStorage Demo Mode
js/search.js           TMDb / Google Books / iTunes / MusicBrainz / IGDB search integrations
js/app.js               App logic: rendering, filtering, modals
supabase/schema.sql      Database schema + Row Level Security policies
supabase/functions/igdb-search/index.ts  Edge Function proxying IGDB search (see "Setting up video game search")
```
