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
- **Discover** — search movies & TV (TMDb), books (Google Books), and
  podcasts (iTunes) and add results with one tap. Anything else (plays,
  restaurants, etc.) can be added by hand.

Rating an item automatically moves it from Wishlist to Journal. Clearing
an item's rating moves it back. Both Wishlist and Journal have their own
search/filter bar with tappable chips to narrow by media type.

Items can be tagged: wishlist items get a single **⭐ Shortlist** tag to
flag your top picks, and once something's marked watched/read you can
multi-select "reaction" tags (Favorite, Would Rewatch, Recommend, Meh,
etc.) — the exact wording adapts per media type (e.g. "Would Reread" for
books). Tags are also searchable in the filter bar.

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
movie/TV search needs a TMDb key either way (see below).

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
js/config.js          Your Supabase + TMDb keys (fill in, safe to commit)
js/storage.js         Data layer: Supabase, or localStorage Demo Mode
js/search.js           TMDb / Google Books / iTunes search integrations
js/app.js               App logic: rendering, filtering, modals
supabase/schema.sql      Database schema + Row Level Security policies
```
