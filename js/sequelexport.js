// Exports the library as a CSV for Sequel (https://sequel.app), which takes
// a generic 14-column import template.
//
// Two mismatches do the real work here:
//
// 1. Sequel tracks movies, shows, games and books. Podcasts, albums, plays,
//    restaurants and "other" have nowhere to go, so those rows are dropped
//    and counted rather than bent into a type that would import cleanly and
//    mean nothing.
//
// 2. Sequel holds a show as one entry. This app holds a show as a container
//    plus one completed row per season, each with its own rating, notes and
//    date. Exported as-is, a three-season show would arrive as four
//    separate entries — so seasons are collapsed back into one row.
//
// Dates are written as the local calendar day, computed in the browser
// doing the export. date_completed is a timestamptz, and reading it as UTC
// would move an evening's viewing onto the following day for anyone west of
// it.

import { isSeasonEntry, showKey } from './items.js';

// The template's columns, in its order. Sequel matches on these names, so
// the header is written verbatim.
const COLUMNS = [
  'Media Type', 'Title', 'Release Date', 'Release Year', 'Author', 'Status',
  'Date Added', 'Date Completed', 'Rating', 'Notes', 'Collections',
  'IMDb ID', 'TMDB ID', 'TVDB ID',
];

const MEDIA_TYPE = { movie: 'Movie', tv: 'Show', book: 'Book', game: 'Game' };

// 'ended' is a finished series, which for Sequel's purposes is Completed —
// the distinction only exists here to keep containers out of the Journal.
const STATUS = {
  completed: 'Completed',
  ended: 'Completed',
  in_progress: 'Watching',
  wishlist: 'Wishlist',
};

// ---------- CSV ----------

// Quote anything that would otherwise break a field boundary, and double
// embedded quotes. RFC 4180.
function csvField(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  return [COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

// ---------- field helpers ----------

function localDay(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// release_date is text and legitimately holds partials — Google Books and
// MusicBrainz return things like '2021-10' for less-cataloged entries. Only
// a complete date belongs in a date column.
function fullDate(releaseDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '') ? releaseDate : '';
}

function releaseYear(item) {
  if (item.year) return String(item.year);
  const match = /^(\d{4})/.exec(item.release_date || '');
  return match ? match[1] : '';
}

// TMDb ids are stored prefixed by type ('movie-550', 'tv-1399'); a season
// entry carries a suffix too ('tv-1399-s2'), and the show's id is what
// Sequel wants. Anything else in external_id — a Letterboxd URI, a Google
// Books volume id, an IGDB id — isn't a TMDb id and must not be passed off
// as one.
function tmdbId(item) {
  if (item.external_source !== 'tmdb') return '';
  const match = /^(?:movie|tv)-(\d+)(?:-s\d+)?$/.exec(item.external_id || '');
  return match ? match[1] : '';
}

// Backlog tags carry a leading emoji ('⭐ Shortlist'); Sequel collections are
// plain text. Joined with ', ' — csvField() quotes the result.
function collections(item) {
  return (item.tags || [])
    .map((t) => String(t).replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean)
    .join(', ');
}

function ratingOf(item) {
  return item.rating ? String(item.rating) : '';
}

function row(fields) {
  return COLUMNS.map((c) => fields[c] ?? '');
}

// ---------- rows ----------

function simpleRow(item) {
  return row({
    'Media Type': MEDIA_TYPE[item.media_type],
    Title: item.title || '',
    'Release Date': fullDate(item.release_date),
    'Release Year': releaseYear(item),
    // The template leaves Author blank for everything but books, and
    // creator holds directors and artists too.
    Author: item.media_type === 'book' ? item.creator || '' : '',
    Status: STATUS[item.status] || '',
    'Date Added': localDay(item.date_added),
    'Date Completed': localDay(item.date_completed),
    Rating: ratingOf(item),
    Notes: item.notes || '',
    Collections: collections(item),
    'TMDB ID': tmdbId(item),
  });
}

// Half-steps because Sequel accepts them: a show rated 5, 4, 4 comes out at
// 4.5 rather than losing the distinction to a whole-number round.
function averageToHalf(ratings) {
  if (!ratings.length) return '';
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const half = Math.round(mean * 2) / 2;
  return Number.isInteger(half) ? String(half) : half.toFixed(1);
}

// One row for a show, from however many rows this app holds for it.
//
// The container carries the status (it's the thing still in progress or
// waiting); the season entries carry the ratings, notes and dates. A show
// with no container is one that's been finished and retired, or one whose
// seasons were logged without one.
function showRow(group) {
  const seasons = group.filter(isSeasonEntry).sort((a, b) => a.season_number - b.season_number);
  const container = group.find((i) => !isSeasonEntry(i));
  const identity = container || seasons[0];

  const completions = seasons.map((s) => s.date_completed).filter(Boolean).sort();
  const added = group.map((i) => i.date_added).filter(Boolean).sort();

  // Season notes stay on one line. Quoted newlines are valid CSV, but not
  // every importer handles them and this field holds the actual writing.
  const notes = seasons
    .filter((s) => s.notes)
    .map((s) => `S${s.season_number}: ${String(s.notes).replace(/\s*\n\s*/g, ' ')}`)
    .join(' · ');

  return row({
    'Media Type': 'Show',
    Title: identity.title || '',
    'Release Date': fullDate(identity.release_date),
    'Release Year': releaseYear(identity),
    Status: container ? STATUS[container.status] || '' : 'Completed',
    'Date Added': localDay(added[0]),
    'Date Completed': localDay(completions[completions.length - 1]),
    Rating: averageToHalf(seasons.map((s) => s.rating).filter(Boolean)),
    Notes: notes || (container && container.notes) || '',
    Collections: collections(identity),
    'TMDB ID': tmdbId(identity),
  });
}

// Builds the file. Returns the CSV plus a count of what didn't make it, so
// the caller can say so rather than leaving a silently shorter library to be
// noticed later.
export function buildSequelCsv(items) {
  const rows = [];
  const skipped = {};
  const shows = new Map();

  for (const item of items) {
    if (item.media_type === 'tv') {
      const key = showKey(item);
      if (!shows.has(key)) shows.set(key, []);
      shows.get(key).push(item);
      continue;
    }
    if (!MEDIA_TYPE[item.media_type]) {
      skipped[item.media_type] = (skipped[item.media_type] || 0) + 1;
      continue;
    }
    rows.push(simpleRow(item));
  }

  // A legacy show-level TV row (completed before per-season tracking, so no
  // season_number) is already one row per show and needs no collapsing.
  for (const group of shows.values()) {
    const legacy = group.filter((i) => !isSeasonEntry(i) && i.status === 'completed');
    const rest = group.filter((i) => !legacy.includes(i));
    legacy.forEach((i) => rows.push(simpleRow(i)));
    if (rest.length) rows.push(showRow(rest));
  }

  return { csv: toCsv(rows), rowCount: rows.length, skipped };
}

export function exportForSequel(items) {
  const { csv, rowCount, skipped } = buildSequelCsv(items);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `media-journal-sequel-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { rowCount, skipped };
}
