# Letting someone else test the site

How to give a friend an account, what they need to know, and how to clean
up afterward.

The live site is at:

```
https://jaredgeizer.github.io/media-journal/
```

That URL comes from GitHub Pages serving the repo's **default branch**
(`main`) at the root. Nothing needs building or deploying — pushing to
`main` updates the live site within a minute or two.

## The short version

1. Create their account in the Supabase dashboard with **Auto Confirm
   User** ticked.
2. Turn off public sign-ups.
3. Send them the URL and their credentials.

Details below.

---

## 1. Create their account

Do **not** ask them to sign up themselves. Sign-up works, but it sends a
confirmation email through Supabase's built-in mail service, which on the
free tier is heavily rate-limited and routinely lands in spam. The app
tells them to "Check your email to confirm your account" and then they're
stuck. Create the account directly instead:

1. Supabase dashboard → **Authentication → Users**
2. **Add user → Create new user**
3. Enter their email and a temporary password
4. **Tick "Auto Confirm User"** — this is the important part; without it
   the account exists but can't sign in
5. **Create user**

They can now sign in immediately at the URL above.

> The app has no change-password screen, so whatever you set is what they
> keep. If they want it changed, do it from **Authentication → Users →
> (their row) → Reset password**.

## 2. Turn off public sign-ups

The site is public and the sign-up form is open to anyone who loads it.
That was harmless while nobody had the link; once you send it out, assume
it can be forwarded.

After their account exists:

**Authentication → Sign In / Providers → Email** → turn off **"Allow new
users to sign up"**

Existing accounts keep working exactly as before. The "Sign up" button on
the login page just starts returning an error. Turn it back on whenever
you want to add another tester, or add them from the dashboard as above.

While you're in there, check **Authentication → URL Configuration → Site
URL** points at the GitHub Pages URL rather than `localhost`, so any
password-reset link that does get sent lands on the real site.

## 3. What to tell them

- **It's a website, not an app** — nothing to install. On iOS, Safari →
  Share → **Add to Home Screen** makes it open full-screen like an app.
  Android Chrome has the same option under its ⋮ menu.
- **It's designed phone-first.** It works on desktop, but the layout is
  built for a phone.
- **Their data is entirely their own.** They won't see your library and
  you won't see theirs.
- **Good things to try:** search and add something from Discover, mark it
  watched and rate it, set a yearly goal, check the Account page's
  activity calendar.

## Is their data really separate?

Yes, and it's enforced by the database rather than by the app being
careful. Every table in `supabase/schema.sql` has Row Level Security with
`auth.uid() = user_id` policies covering select, insert, update and
delete. Even a modified copy of the front-end using the same public key
cannot read another user's rows — the database rejects it.

The `anon` key published in `js/config.js` is safe for exactly this
reason. It identifies the project, it doesn't grant access to data. See
the note in the main README.

Worth verifying yourself once: sign in as them in a private window, add
something, and confirm it doesn't appear in your library.

## What you're sharing besides the app

Their usage runs through the same API credentials as yours:

| Service | Where the key lives | Free tier |
|---|---|---|
| TMDb (movies/TV) | `js/config.js`, public | Generous; not a concern |
| Google Books | `js/config.js`, public | 1,000 requests/day |
| IGDB (games) | Supabase secret, server-side | 4 requests/second |
| Supabase | Project itself | 500 MB database, 50k monthly active users |

None of these are close to being a problem for one extra person. They're
listed so nothing is a surprise.

The Google Books key needs care that the others don't. It's public in
`js/config.js`, and unlike the Supabase anon key (protected by Row Level
Security by design) or the read-only TMDb token, it bills and
rate-limits against your Google Cloud project. GitHub's secret scanning
flags it on a public repo, correctly.

Keep it restricted — **API restrictions** limited to the Books API, and
**Application restrictions** → **Websites** (formerly labelled "HTTP
referrers") set to `https://jaredgeizer.github.io/*`, both under Google
Cloud Console → Credentials → the key. The API restriction is the
important half: it's what stops an exposed key reaching any other API
enabled on the project.

If a key ever does get published unrestricted, restricting it afterward
isn't enough — it's in git history permanently and bots scrape GitHub
continuously. Delete it in Google Cloud and issue a fresh restricted
one. See the README's Google Books section for the full steps.

## Removing a tester afterward

**Authentication → Users** → their row → **Delete user**.

Their items, goals and settings go with them automatically — `user_id` is
declared `on delete cascade` in `supabase/schema.sql`, so deleting the
account removes every row it owns. Nothing to clean up by hand.

## Collecting feedback

There's no in-app feedback mechanism. Simplest options:

- Just have them text you.
- Or turn on GitHub Issues for the repo and let them file things there —
  it's a public repo, so they only need a GitHub account.
