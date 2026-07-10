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
  external_source text,       -- 'tmdb' | 'google_books' | 'itunes' | 'apple_music' | 'rawg' | 'manual'
  external_id     text,
  external_url    text,       -- link to the source page (e.g. Apple Podcasts, Google Books)

  -- journal state
  status         text not null default 'wishlist' check (status in ('wishlist', 'in_progress', 'completed')),
  rating         smallint check (rating between 1 and 5),
  notes          text,
  tags           text[] not null default '{}',

  -- progress tracking (books, video games & TV shows only, while status = 'in_progress')
  progress_percent smallint check (progress_percent between 0 and 100),  -- books & video games
  progress_season   smallint,                                            -- TV shows
  progress_episode  smallint,                                            -- TV shows

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
