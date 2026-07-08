# Media Journal

A personal media journal / blog: track what you want to watch, read, or
listen to, and log what you've finished with a rating and notes. Built as
plain HTML/CSS/JS with a "liquid glass" (frosted, translucent) design,
so it hosts anywhere as static files and works well on phone, tablet, and
desktop.

## How it works

- **Wishlist** — things you want to watch/read/listen to eventually.
- **Journal** — a blog-style feed of things you've finished, with your
  star rating and notes, newest first.
- **Discover** — search movies & TV (TMDb), books (Google Books),
  podcasts (iTunes), and video games (RAWG) and add results with one
  tap. Anything else (plays, restaurants, etc.) can be added by hand.

Clicking any item opens a modal with a **Mark as Watched/Read** button
(everything except that lives in a second "review" step). That review
modal has no Save button — the star rating and tags save the instant you
tap them, and notes save automatically when you click away from the
textarea. An already-reviewed item shows its rating/tags/notes as a
summary with **Edit Review** and **Move back to Wishlist/Currently**
actions. Both Wishlist and Journal have their own search/filter bar with
tappable chips to narrow by media type.

Items can be tagged: wishlist items get a single **⭐ Shortlist** tag to
flag your top picks. In the review modal you can multi-select tags —
**Favorite** is always offered, and beyond that tags are entirely
user-defined: type a new one to create it, and it becomes a suggested
chip for other items of that same media type going forward. Tags are
searchable in the filter bar, and the Journal has a dedicated Tags
filter (multi-select dropdown of every tag you've used).

From Discover, adding a result gives three options: **Add to Wishlist**,
**Mark as Watched/Read** (creates the item and opens the review modal),
or — for books, video games, and TV shows only — **Currently
Reading/Watching/Playing**, which files it at the top of the Journal
with editable progress (percent-complete for books & games, season/
episode for TV — TV cards also get a one-tap **Next Episode** button)
until you mark it watched/read, which moves it into the journal feed
below.

## Running it locally (Demo Mode)

No setup required. Just serve the folder and open it in a browser:

```
cd media-journal
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. With no Supabase config, the app runs
in **Demo Mode**: your data is saved to `localStorage` in that one
browser only. It's a good way to try the UI before setting up real
storage. Book and podcast search work in Demo Mode too (no key needed);
movie/TV search needs a TMDb key and video game search needs a RAWG key
either way (see below).

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
alter table public.items add constraint items_media_type_check check (media_type in ('movie', 'tv', 'book', 'podcast', 'game', 'play', 'restaurant', 'other'));
```

## Setting up movie & TV search (TMDb)

1. Create a free account at [themoviedb.org](https://www.themoviedb.org).
2. Go to **Settings → API**, request a free API key, then copy the
   **API Read Access Token (v4 auth)**.
3. Paste it into `tmdbAccessToken` in `js/config.js`.

Podcast search (iTunes Search API) needs no key and works out of the box.

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

## Setting up video game search (RAWG)

1. Create a free account at [rawg.io/apidocs](https://rawg.io/apidocs).
2. Copy your API key from the API docs page (it's generated automatically
   for your account).
3. Paste it into `rawgApiKey` in `js/config.js`.

Free tier is 20,000 requests/month, plenty for personal use. RAWG asks
that apps using their free API credit them — the footer already
includes a "Game data from RAWG.io" line, so no extra setup needed there.

## Importing your data

Under the account menu (👤 in the header) → **Import / Export**, you can:

- **Export** your whole library as a JSON file (also doubles as a backup).
- **Import from Goodreads**: export your library at
  [goodreads.com/review/import](https://www.goodreads.com/review/import) →
  "Export Library", then upload the `.csv` file. Shelves map to status
  (`read` → completed, `currently-reading` → in progress, `to-read` →
  wishlist) and your 1–5 star rating carries over.
- **Import from Fable**: Fable has no official export. Use a third-party
  browser extension (e.g. "Fable Xport") to generate a Goodreads-style
  `.csv`, then upload it the same way as a Goodreads file.
- **Import from Letterboxd**: export your data at
  [letterboxd.com/user/exportdata](https://letterboxd.com/user/exportdata/)
  and upload the `.zip` as-is — no need to unzip it first. Letterboxd's
  half-star ratings (0.5–5) are rounded to the nearest whole star to fit
  this app's 1–5 scale.

Every import shows a preview (how many items will be added vs. skipped as
already-in-your-library duplicates) before anything is written. Imported
items don't get poster images or descriptions automatically — edit an item
afterward to add those by hand, or re-add it from Discover to pick up
artwork from a search result.

Serializd isn't supported yet — it doesn't currently offer a reliable free
export.

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
index.html          Main app (Wishlist / Journal / Discover)
login.html           Sign in / sign up (Supabase mode only)
css/style.css        Liquid-glass design system
js/config.js          Your Supabase + API keys (fill in, safe to commit)
js/storage.js         Data layer: Supabase, or localStorage Demo Mode
js/search.js           TMDb / Google Books / iTunes / RAWG search integrations
js/app.js               App logic: rendering, filtering, modals
supabase/schema.sql      Database schema + Row Level Security policies
```
