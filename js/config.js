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
// Leaving these as placeholders runs the app in local Demo Mode: data is
// stored only in this browser (localStorage) and search falls back to a
// small built-in sample so you can try the UI before setting anything up.

window.MEDIA_JOURNAL_CONFIG = {
  supabaseUrl: 'YOUR_SUPABASE_PROJECT_URL',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  tmdbAccessToken: 'YOUR_TMDB_V4_READ_ACCESS_TOKEN',
};
