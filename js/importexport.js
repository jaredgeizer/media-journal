// Import from other trackers (Goodreads, Fable, Letterboxd) and export a
// full backup of the user's library.
//
// Import parsers return normalized arrays shaped like `items` rows (minus
// id/user_id/etc — same shape returned by js/search.js searchers). CSV
// parsing uses PapaParse, ZIP reading uses JSZip — both loaded via CDN
// <script> tags in index.html, exposed as window.Papa / window.JSZip.

const SHELF_STATUS = {
  read: 'completed',
  'currently-reading': 'in_progress',
  'to-read': 'wishlist',
};

// Handles both 'YYYY/MM/DD' (Goodreads) and 'YYYY-MM-DD' (Letterboxd).
function toIsoDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(/[-/]/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

function clampRating(raw) {
  const n = Math.round(parseFloat(raw));
  if (Number.isNaN(n) || n < 1) return null;
  return Math.min(5, n);
}

function parseCsv(csvText) {
  if (!window.Papa) throw new Error('CSV parser failed to load — check your connection and try again.');
  const { data } = window.Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return data;
}

function mapGoodreadsRow(row, source) {
  const title = (row['Title'] || '').trim();
  if (!title) return null;
  const shelf = (row['Exclusive Shelf'] || '').trim().toLowerCase();
  const status = SHELF_STATUS[shelf] || 'wishlist';
  const rating = clampRating(row['My Rating']);
  const review = (row['My Review'] || '').trim();
  const bookId = (row['Book Id'] || '').trim();
  return {
    media_type: 'book',
    title,
    creator: (row['Author'] || '').trim() || null,
    year: (row['Original Publication Year'] || row['Year Published'] || '').trim() || null,
    poster_url: null,
    description: null,
    external_source: source,
    external_id: bookId || null,
    external_url: source === 'goodreads' && bookId ? `https://www.goodreads.com/book/show/${bookId}` : null,
    status,
    rating,
    notes: review || null,
    date_completed: status === 'completed' ? toIsoDate(row['Date Read']) : null,
    date_added: toIsoDate(row['Date Added']) || new Date().toISOString(),
  };
}

export function parseGoodreadsCsv(csvText) {
  return parseCsv(csvText)
    .map((row) => mapGoodreadsRow(row, 'goodreads'))
    .filter(Boolean);
}

export function parseFableCsv(csvText) {
  return parseCsv(csvText)
    .map((row) => mapGoodreadsRow(row, 'fable'))
    .filter(Boolean);
}

async function readCsvFromZip(zip, filename) {
  const file = zip.file(filename);
  if (!file) return [];
  const text = await file.async('string');
  return parseCsv(text);
}

export async function parseLetterboxdZip(arrayBuffer) {
  if (!window.JSZip) throw new Error('ZIP reader failed to load — check your connection and try again.');
  const zip = await window.JSZip.loadAsync(arrayBuffer);
  const [watched, diary, ratings, watchlist] = await Promise.all([
    readCsvFromZip(zip, 'watched.csv'),
    readCsvFromZip(zip, 'diary.csv'),
    readCsvFromZip(zip, 'ratings.csv'),
    readCsvFromZip(zip, 'watchlist.csv'),
  ]);

  if (!watched.length && !diary.length && !ratings.length && !watchlist.length) {
    throw new Error('No recognizable Letterboxd export files found in that zip.');
  }

  const byUri = new Map();

  function upsert(row, extra) {
    const uri = row['Letterboxd URI'];
    if (!uri) return;
    const base = byUri.get(uri) || {
      media_type: 'movie',
      title: row['Name'],
      creator: null,
      year: row['Year'] || null,
      poster_url: null,
      description: null,
      external_source: 'letterboxd',
      external_id: uri,
      external_url: uri,
      status: 'completed',
      rating: null,
      notes: null,
      date_completed: null,
      date_added: toIsoDate(row['Date']) || new Date().toISOString(),
    };
    const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null));
    byUri.set(uri, { ...base, ...clean });
  }

  watched.forEach((row) => upsert(row, {}));
  diary.forEach((row) =>
    upsert(row, {
      date_completed: toIsoDate(row['Watched Date'] || row['Date']),
      rating: row['Rating'] ? clampRating(row['Rating']) : undefined,
    })
  );
  ratings.forEach((row) => upsert(row, { rating: row['Rating'] ? clampRating(row['Rating']) : undefined }));

  const completed = Array.from(byUri.values());
  const completedUris = new Set(completed.map((i) => i.external_id));

  const backlogItems = watchlist
    .filter((row) => row['Letterboxd URI'] && !completedUris.has(row['Letterboxd URI']))
    .map((row) => ({
      media_type: 'movie',
      title: row['Name'],
      creator: null,
      year: row['Year'] || null,
      poster_url: null,
      description: null,
      external_source: 'letterboxd',
      external_id: row['Letterboxd URI'],
      external_url: row['Letterboxd URI'],
      status: 'wishlist',
      rating: null,
      notes: null,
      date_added: toIsoDate(row['Date']) || new Date().toISOString(),
    }));

  return [...completed, ...backlogItems];
}

// Same match shape as findLibraryMatch() in app.js, applied against a
// caller-supplied library snapshot instead of the module-level `items`.
export function dedupeAgainstLibrary(incoming, existingItems) {
  const toAdd = [];
  const skipped = [];
  for (const item of incoming) {
    const match = existingItems.find(
      (i) =>
        (item.external_id &&
          item.external_source &&
          i.external_id === item.external_id &&
          i.external_source === item.external_source) ||
        (i.media_type === item.media_type && i.title.trim().toLowerCase() === (item.title || '').trim().toLowerCase())
    );
    if (match) skipped.push(item);
    else toAdd.push(item);
  }
  return { toAdd, skipped };
}

export function exportAsJson(items) {
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `media-journal-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
