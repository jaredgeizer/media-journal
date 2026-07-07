// External search integrations for the "Discover" tab. Each search function
// returns a normalized array of result objects shaped like an `items` row
// (minus id/status/etc, which get filled in when the user adds it).
//
// - Movies & TV: TMDb (needs a free API token in js/config.js)
// - Books: Google Books (no key required)
// - Podcasts: iTunes Search API (no key required)
// - Plays / restaurants / other: no free search API wired up — added manually.

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

function tmdbToken() {
  const t = (window.MEDIA_JOURNAL_CONFIG || {}).tmdbAccessToken;
  return t && !t.startsWith('YOUR_') ? t : null;
}

export function tmdbAvailable() {
  return !!tmdbToken();
}

async function searchMovies(query) {
  const token = tmdbToken();
  if (!token) return [];
  const res = await fetch(
    `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}&include_adult=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`TMDb movie search failed (${res.status})`);
  const data = await res.json();
  return data.results.map((r) => ({
    media_type: 'movie',
    title: r.title,
    creator: null,
    year: (r.release_date || '').slice(0, 4) || null,
    poster_url: r.poster_path ? TMDB_IMG + r.poster_path : null,
    description: r.overview || null,
    external_source: 'tmdb',
    external_id: `movie-${r.id}`,
  }));
}

async function searchTV(query) {
  const token = tmdbToken();
  if (!token) return [];
  const res = await fetch(
    `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}&include_adult=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`TMDb TV search failed (${res.status})`);
  const data = await res.json();
  return data.results.map((r) => ({
    media_type: 'tv',
    title: r.name,
    creator: null,
    year: (r.first_air_date || '').slice(0, 4) || null,
    poster_url: r.poster_path ? TMDB_IMG + r.poster_path : null,
    description: r.overview || null,
    external_source: 'tmdb',
    external_id: `tv-${r.id}`,
  }));
}

async function searchBooks(query) {
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20`
  );
  if (!res.ok) throw new Error(`Book search failed (${res.status})`);
  const data = await res.json();
  return (data.items || []).map((r) => {
    const v = r.volumeInfo || {};
    const thumb = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
    return {
      media_type: 'book',
      title: v.title,
      creator: (v.authors || []).join(', ') || null,
      year: (v.publishedDate || '').slice(0, 4) || null,
      poster_url: thumb ? thumb.replace(/^http:/, 'https:') : null,
      description: v.description || null,
      external_source: 'google_books',
      external_id: r.id,
    };
  });
}

async function searchPodcasts(query) {
  const res = await fetch(
    `https://itunes.apple.com/search?media=podcast&limit=20&term=${encodeURIComponent(query)}`
  );
  if (!res.ok) throw new Error(`Podcast search failed (${res.status})`);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    media_type: 'podcast',
    title: r.collectionName || r.trackName,
    creator: r.artistName || null,
    year: (r.releaseDate || '').slice(0, 4) || null,
    poster_url: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '600x600') : null,
    description: r.primaryGenreName ? `${r.primaryGenreName} podcast` : null,
    external_source: 'itunes',
    external_id: String(r.collectionId || r.trackId),
  }));
}

const SEARCHERS = {
  movie: searchMovies,
  tv: searchTV,
  book: searchBooks,
  podcast: searchPodcasts,
};

export const SEARCHABLE_TYPES = Object.keys(SEARCHERS);

// Runs every source relevant to `mediaType` ('all' or a specific type) and
// returns { results, errors } so a single failing source doesn't block the
// rest of the search.
export async function search(query, mediaType) {
  const types = mediaType === 'all' ? SEARCHABLE_TYPES : [mediaType];
  const results = [];
  const errors = [];

  await Promise.all(
    types.map(async (type) => {
      try {
        const found = await SEARCHERS[type](query);
        results.push(...found);
      } catch (err) {
        errors.push({ type, message: err.message });
      }
    })
  );

  return { results, errors };
}
