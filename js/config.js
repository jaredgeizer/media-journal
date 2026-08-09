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
//   4. Recommended: click the new key → restrict it to the Books API, and
//      under "Application restrictions" add your GitHub Pages URL as an
//      allowed HTTP referrer (e.g. https://jaredgeizer.github.io/*)
//
// RAWG API key (required for video game search) — no longer goes here.
// RAWG blocks direct browser requests (no CORS headers), so the key now
// lives server-side as a Supabase secret read by a small Edge Function
// (supabase/functions/rawg-search) instead — see README's "Setting up
// video game search (RAWG)" section for the deploy steps. The
// `rawgApiKey` field below is no longer read by the app; safe to delete
// once you've moved the key over.
//
// Leaving these as placeholders runs the app in local Demo Mode: data is
// stored only in this browser (localStorage) and search falls back to a
// small built-in sample so you can try the UI before setting anything up.

window.MEDIA_JOURNAL_CONFIG = {
  supabaseUrl: 'https://wdoxefmlztkhccbvnecs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indkb3hlZm1senRraGNjYnZuZWNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NDU4MjQsImV4cCI6MjA5OTAyMTgyNH0.AXKWd7tVyZO4o6p3dpaZIam00T_0FYYZCCRFVjnEvfU',
  tmdbAccessToken: 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIxOWVhNWIwMDRkYzAyYzBjOWRjM2ZlZGFiMGM3OGU3ZSIsIm5iZiI6MTc2MTY4MDUwOS40MDcsInN1YiI6IjY5MDExYzdkZGY5YWFmMWNmMWE2MzlkZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.nMOluNqeVlpyCL7kdkNIecRylqEfX7jzch6mk9jIqSo',
  googleBooksApiKey: 'AIzaSyA77R0j1mVLUVc-GwlY6hC__EdqbUdBJiA',
  rawgApiKey: 'f8e821663e614e40b1bf06d327c84b66',
};
