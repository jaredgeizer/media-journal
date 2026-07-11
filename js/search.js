// External search integrations for the "Discover" tab. Each search function
// returns a normalized array of result objects shaped like an `items` row
// (minus id/status/etc, which get filled in when the user adds it).
//
// - Movies & TV: TMDb (needs a free API token in js/config.js)
// - Books: Google Books (works without a key, but shares a low global quota —
//   add a free Google API key in js/config.js to get your own quota)
// - Podcasts: iTunes Search API (no key required)
// - Albums: MusicBrainz (no key required)
// - Video games: RAWG.io (needs a free API key in js/config.js)
// - Plays / restaurants / other: no free search API wired up — added manually.

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

function tmdbToken() {
  const t = (window.MEDIA_JOURNAL_CONFIG || {}).tmdbAccessToken;
  return t && !t.startsWith('YOUR_') ? t : null;
}

export function tmdbAvailable() {
  return !!tmdbToken();
}

// TMDb's raw per-show season list often undercounts anime, where a show's
// real (fan-facing) seasons don't match how TMDb split up its own `seasons`
// array. Many anime instead have a named "episode group" (an alternate
// season breakdown TMDb itself prefers to display) that gets this right —
// so when one exists and has more seasons than the raw list, use it instead.
async function getSeasonEpisodeGroup(tmdbId, token) {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/episode_groups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const candidate = (data.results || []).find((g) => /season/i.test(g.name || ''));
    if (!candidate) return null;

    const detailRes = await fetch(`https://api.themoviedb.org/3/tv/episode_group/${candidate.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!detailRes.ok) return null;
    const detail = await detailRes.json();
    const seasons = (detail.groups || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((g, idx) => ({ seasonNumber: idx + 1, episodeCount: (g.episodes || []).length }));
    return seasons.length ? { seasons } : null;
  } catch {
    return null;
  }
}

// Season/episode counts aren't in the search results — needs its own call
// to the TV Details endpoint, keyed by the TMDb id (not our own item id).
export async function getTVSeasonInfo(tmdbId) {
  const token = tmdbToken();
  if (!token) return null;
  let rawInfo = null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const seasons = (data.seasons || [])
        .filter((s) => s.season_number > 0)
        .map((s) => ({ seasonNumber: s.season_number, episodeCount: s.episode_count }));
      rawInfo = seasons.length ? { seasons } : null;
    }
  } catch {
    rawInfo = null;
  }

  const groupInfo = await getSeasonEpisodeGroup(tmdbId, token);
  if (groupInfo && (!rawInfo || groupInfo.seasons.length > rawInfo.seasons.length)) {
    return groupInfo;
  }
  return rawInfo;
}

// A handful of these free/keyless APIs can fail at the network level rather
// than returning a clean HTTP error — a rejected fetch() (Safari calls this
// "Load failed", Chrome "Failed to fetch") rather than a response with a
// bad status code. iTunes Search in particular seems to trip this when two
// requests to itunes.apple.com go out at once, which happens here since
// podcast and album search both hit it and can run concurrently during an
// "all types" search. Retry once after a short delay before giving up.
async function fetchWithRetry(url, options, retries = 1) {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return fetchWithRetry(url, options, retries - 1);
  }
}

function googleBooksKey() {
  const k = (window.MEDIA_JOURNAL_CONFIG || {}).googleBooksApiKey;
  return k && !k.startsWith('YOUR_') ? k : null;
}

function rawgKey() {
  const k = (window.MEDIA_JOURNAL_CONFIG || {}).rawgApiKey;
  return k && !k.startsWith('YOUR_') ? k : null;
}

export function rawgAvailable() {
  return !!rawgKey();
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
    release_date: r.release_date || null,
    poster_url: r.poster_path ? TMDB_IMG + r.poster_path : null,
    description: r.overview || null,
    external_source: 'tmdb',
    external_id: `movie-${r.id}`,
    popularity: r.popularity || 0,
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
    popularity: r.popularity || 0,
  }));
}

async function searchBooks(query) {
  const key = googleBooksKey();
  const keyParam = key ? `&key=${encodeURIComponent(key)}` : '';
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20${keyParam}`
  );
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      if (errBody && errBody.error && errBody.error.message) detail = ` — ${errBody.error.message}`;
    } catch {
      // response wasn't JSON; ignore
    }
    const hint = res.status === 429 ? ' Add a free Google Books API key to js/config.js to get your own quota (see README).' : '';
    throw new Error(`Book search failed (${res.status})${detail}.${hint}`);
  }
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
      external_url: v.infoLink || null,
    };
  });
}

async function searchPodcasts(query) {
  const res = await fetchWithRetry(
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
    external_url: r.collectionViewUrl || r.trackViewUrl || null,
  }));
}

// Unlike the iTunes Search API used above, MusicBrainz's search endpoint
// (also free/keyless) is a public API explicitly designed for direct
// browser/CORS use, and doesn't single out music-catalog queries the way
// iTunes appears to (podcast search there works fine; music/album search
// does not, consistently, for some clients).
async function searchAlbums(query) {
  const res = await fetchWithRetry(
    `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=20`
  );
  if (!res.ok) throw new Error(`Album search failed (${res.status})`);
  const data = await res.json();
  return (data['release-groups'] || []).map((r) => ({
    media_type: 'album',
    title: r.title,
    creator: (r['artist-credit'] || []).map((a) => a.name).join(', ') || null,
    year: (r['first-release-date'] || '').slice(0, 4) || null,
    // Cover art isn't in the release-group response — MusicBrainz's
    // companion Cover Art Archive serves it at a predictable per-MBID URL
    // instead of needing an extra fetch per result. Not every release group
    // has cover art, so this 404s sometimes; posterOrEmoji() in app.js
    // falls back to the usual placeholder when that happens.
    poster_url: `https://coverartarchive.org/release-group/${r.id}/front-500`,
    description: r['primary-type'] || null,
    external_source: 'musicbrainz',
    external_id: r.id,
    external_url: `https://musicbrainz.org/release-group/${r.id}`,
  }));
}

async function searchGames(query) {
  const key = rawgKey();
  if (!key) return [];
  const res = await fetch(
    `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=20`
  );
  if (!res.ok) {
    let detail = '';
    try {
      const errBody = await res.json();
      if (errBody && errBody.detail) detail = ` — ${errBody.detail}`;
    } catch {
      // response wasn't JSON; ignore
    }
    throw new Error(`Game search failed (${res.status})${detail}`);
  }
  const data = await res.json();
  return (data.results || []).map((r) => {
    const genres = (r.genres || []).map((g) => g.name).join(', ');
    return {
      media_type: 'game',
      title: r.name,
      creator: null,
      year: (r.released || '').slice(0, 4) || null,
      poster_url: r.background_image || null,
      description: genres || null,
      external_source: 'rawg',
      external_id: String(r.id),
      external_url: r.slug ? `https://rawg.io/games/${r.slug}` : null,
      popularity: r.added || 0,
    };
  });
}

const SEARCHERS = {
  movie: searchMovies,
  tv: searchTV,
  book: searchBooks,
  podcast: searchPodcasts,
  album: searchAlbums,
  game: searchGames,
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
