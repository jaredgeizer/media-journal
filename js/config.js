// Fill these in with your own values, then commit this file so GitHub Pages
// can serve it — see README.md for step-by-step setup.
//
// Supabase (required for cross-device sync):
//   1. Create a free project at https://supabase.com
//   2. Run supabase/schema.sql in the SQL editor (Project → SQL Editor → New query)
//   3. Project Settings → API → copy the "Project URL" and "anon public" key below
//   (The anon key is meant to be public — your data is protected by the Row
//   Level Security policies in schema.sql, not by hiding this key.)
//
// TMDb (optional, powers movie/TV search):
//   1. Create a free account at https://www.themoviedb.org
//   2. Settings → API → request a key → copy the "API Read Access Token" (v4 auth) below
//
// Google Books API key (optional, avoids the shared 429-rate-limited quota
// that unkeyed requests share with the whole internet):
//   1. Go to https://console.cloud.google.com, create/select a project
//   2. APIs & Services → Library → enable "Books API"
//   3. APIs & Services → Credentials → Create Credentials → API key → copy it below
//   4. Restrict the key — required, not optional. Click into it and set
//      "API restrictions" to the Books API only, and "Application
//      restrictions" to Websites (formerly labelled "HTTP referrers")
//      with your Pages URL, e.g. https://jaredgeizer.github.io/*
//
//      The API restriction is the real boundary; the Websites check only
//      deters casual reuse, since Google trusts a Referer header that a
//      non-browser client sets freely. Unlike the Supabase anon key
//      above — public by design, with RLS protecting the data — this one
//      bills against your Google Cloud project, so an unrestricted copy
//      in a public repo is a genuine problem. GitHub's secret scanning
//      will flag it, correctly. See the README's Google Books section.
//
// IGDB credentials (required for video game search) — these don't go here.
// IGDB blocks direct browser requests (no CORS headers), so its Twitch
// client id/secret live server-side as Supabase secrets read by a small
// Edge Function (supabase/functions/igdb-search) instead — see README's
// "Setting up video game search (IGDB)" section for the deploy steps.
//
// Leaving these as placeholders runs the app in local Demo Mode: data is
// stored only in this browser (localStorage) and search falls back to a
// small built-in sample so you can try the UI before setting anything up.

window.MEDIA_JOURNAL_CONFIG = {
  supabaseUrl: 'https://wdoxefmlztkhccbvnecs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkb3hlZm1senRraGNjYnZuZWNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDU4MjQsImV4cCI6MjA5OTAyMTgyNH0.AXKWd7tVyZO4o6p3dpaZIam00T_0FYYZCCRFVjnEvfU',
  tmdbAccessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxOWVhNWIwMDRkYzAyYzBjOWRjM2ZlZGFiMGM3OGU3ZSIsIm5iZiI6MTc2MTY4MDUwOS40MDcsInN1YiI6IjY5MDExYzdkZGY5YWFmMWNmMWE2MzlkZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.nMOluNqeVlpyCL7kdkNIecRylqEfX7jzch6mk9jIqSo',
  googleBooksApiKey: 'AIzaSyAnHd6Ygphpl3edn_MZnrj-S1QvPTHYGYE',
};
