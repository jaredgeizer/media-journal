import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable, rawgAvailable, getTVSeasonInfo, getSeasonEpisodeNames, SEARCHABLE_TYPES } from './search.js';
import { parseGoodreadsCsv, parseFableCsv, parseLetterboxdZip, dedupeAgainstLibrary, exportAsJson, matchesLibraryItem } from './importexport.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', album: '💿', game: '🎮', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', album: 'Album', game: 'Video Game', play: 'Play', restaurant: 'Restaurant', other: 'Other' };
// Account page pie chart — fixed hue-per-type (see the --type-* custom
// properties in style.css for the validated light/dark hex values and why
// 'other' isn't a categorical slot).
const TYPE_COLOR = {
  movie: 'var(--type-movie)',
  tv: 'var(--type-tv)',
  book: 'var(--type-book)',
  podcast: 'var(--type-podcast)',
  album: 'var(--type-album)',
  game: 'var(--type-game)',
  play: 'var(--type-play)',
  restaurant: 'var(--type-restaurant)',
  other: 'var(--type-other)',
};
// Plural forms for custom-goal card titles/congrats text (e.g. "12 movies
// and video games this year") — kept as an explicit map rather than naive
// string concatenation so "TV Show" -> "TV shows" reads correctly.
const TYPE_LABEL_PLURAL = {
  movie: 'movies',
  tv: 'TV shows',
  book: 'books',
  podcast: 'podcasts',
  album: 'albums',
  game: 'video games',
  play: 'plays',
  restaurant: 'restaurants',
  other: 'other items',
};
const EXTERNAL_LINK_LABEL = { itunes: 'Open in Apple Podcasts', musicbrainz: 'View on MusicBrainz', google_books: 'View on Google Books' };
const COMPLETED_VERB = { movie: 'Watched', tv: 'Watched', book: 'Read', podcast: 'Listened', album: 'Listened', game: 'Played', play: 'Seen', restaurant: 'Been', other: 'Done' };
const START_LABEL = { book: 'Start Reading', tv: 'Start Watching', game: 'Start Playing' };
const CURRENTLY_LABEL = { book: 'Currently Reading', tv: 'Currently Watching', game: 'Currently Playing' };

const PERCENT_PROGRESS_TYPES = ['book', 'game'];
const EPISODE_PROGRESS_TYPES = ['tv'];
const PROGRESS_TYPES = [...PERCENT_PROGRESS_TYPES, ...EPISODE_PROGRESS_TYPES];
const BACKLOG_TAGS = ['⭐ Shortlist', '👍 Recommended', '🆕 New Season', 'Dropped'];
const SHORTLIST_TAG = '⭐ Shortlist';
// Keeps each media type's Shortlist meaningful as an actual short list,
// rather than most of the Backlog ending up tagged. Enforced as a soft cap
// (see shortlistOverflowRedirect()) rather than blocking the tag outright,
// since the item the user just picked is still the one they meant to
// shortlist — the fix is trimming an older pick, not losing this one.
const SHORTLIST_LIMIT = 4;
// New Season and Dropped only ever mean anything for a TV show cycling
// back to Backlog on its own (see checkForNewTvSeasons() and
// checkForStaleProgress()) — offering them as pickable tags on a
// movie/book/etc. would just be confusing, so both are excluded from the
// edit modal's tag chips for every other media type.
const TV_ONLY_BACKLOG_TAGS = ['🆕 New Season', 'Dropped'];
function backlogTagsFor(mediaType) {
  return mediaType === 'tv' ? BACKLOG_TAGS : BACKLOG_TAGS.filter((t) => !TV_ONLY_BACKLOG_TAGS.includes(t));
}

function shortlistCountForType(mediaType) {
  return items.filter((i) => i.status === 'wishlist' && i.media_type === mediaType && (i.tags || []).includes(SHORTLIST_TAG)).length;
}
const ALL_TYPES = ['movie', 'tv', 'book', 'podcast', 'album', 'game', 'play', 'restaurant', 'other'];
const QUICK_TAGS = { journal: ['❤️ Favorite'], backlog: ['⭐ Shortlist'] };

const store = createStore();
let items = [];
// Preloaded in loadItems() so openEditModal() can build the Libby link
// synchronously — a saved library code rarely changes, so there's no need
// to fetch it fresh on every modal open.
let libbyLibraryCode = null;
let backlogSelectedTags = new Set();
let journalSelectedTags = new Set();
let journalSelectedRatings = new Set();
let backlogSelectedTypes = new Set();
let journalSelectedTypes = new Set();
let journalSortKey = 'completed_desc';
let backlogSortKey = 'added_desc';
let backlogViewMode = 'grid';
// When set, tapping a Discover result updates this existing item's fields
// instead of creating a new one — how "Update Info" fills in a quick-added
// item's real details.
let discoverMergeTargetId = null;
// Set from store.onAuthChange() — used by the Account modal to show who's
// signed in. null in Demo Mode (there's no real account) or before the
// first auth callback fires.
let currentUser = null;

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Built-in tags (Favorite/Shortlist/Recommended) bake an emoji into their
// stored value so old data and filter matching keep working untouched —
// this strips a leading emoji for display only, wherever a tag renders as
// text (pills, chips, filter checkboxes). Plain user-added tags pass through.
function stripTagEmoji(tag) {
  return tag.replace(/^\p{Extended_Pictographic}️?\s*/u, '');
}

// ---------- Recent searches ----------

const RECENT_SEARCHES_KEY = 'mediaJournal.recentSearches';
const MAX_RECENT_SEARCHES = 8;

function getRecentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function addRecentSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  const rest = getRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify([trimmed, ...rest].slice(0, MAX_RECENT_SEARCHES)));
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}

const RECENT_SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 15"></polyline></svg>';

// Wires a text input to show a "recent searches" dropdown on focus. Clicking
// an entry (or Clear) is handled via a mousedown-preventDefault on the
// dropdown so the input never blurs before the click registers.
function wireRecentSearchDropdown(input, dropdown, onSelect) {
  function render() {
    const recents = getRecentSearches();
    if (!recents.length) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
      return;
    }
    dropdown.innerHTML = `
      ${recents.map((q) => `<button type="button" class="recent-search-item" data-query="${escapeHtml(q)}">${RECENT_SEARCH_ICON}${escapeHtml(q)}</button>`).join('')}
      <button type="button" class="recent-search-clear">Clear recent searches</button>
    `;
    dropdown.classList.remove('hidden');
  }

  dropdown.addEventListener('mousedown', (e) => e.preventDefault());
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.recent-search-item');
    if (item) {
      dropdown.classList.add('hidden');
      input.blur();
      onSelect(item.dataset.query);
      return;
    }
    if (e.target.closest('.recent-search-clear')) {
      clearRecentSearches();
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
  });

  input.addEventListener('focus', render);
  input.addEventListener('blur', () => dropdown.classList.add('hidden'));
}

// ---------- Boot ----------

async function boot() {
  el('journalFeed').innerHTML = Array.from({ length: 4 }, journalSkeletonEntryHtml).join('');
  el('backlogGrid').innerHTML = Array.from({ length: 8 }, skeletonCardHtml).join('');

  await store.init();

  el('accountMenu').classList.remove('hidden');
  el('notifMenu').classList.remove('hidden');
  if (store.mode === 'demo') {
    el('demoBanner').classList.remove('hidden');
    el('signOutBtn').classList.add('hidden');
  }

  store.onAuthChange(async (user) => {
    if (!user && store.mode === 'supabase') {
      location.replace('login.html');
      return;
    }
    currentUser = user;
    await loadItems();
  });
}

// One-time, self-healing migration: the "Favorite" tag used to be stored
// plain; it's now "❤️ Favorite" (matching how Shortlist/Recommended already
// bake their emoji into the stored value). Runs on every load but is a
// no-op once nothing has the old tag anymore.
async function migrateFavoriteTag() {
  const toFix = items.filter((i) => (i.tags || []).includes('Favorite'));
  for (const item of toFix) {
    const tags = item.tags.map((t) => (t === 'Favorite' ? '❤️ Favorite' : t));
    try {
      const updated = await store.updateItem(item.id, { tags });
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) items[idx] = updated;
    } catch (err) {
      // One bad write (e.g. a lagging network) shouldn't block the rest of
      // the app from loading — this item just stays on the old tag and
      // gets picked up again next load.
      console.warn('migrateFavoriteTag: failed to update', item.id, err);
    }
  }
}

async function loadItems() {
  items = await store.listItems();
  await migrateFavoriteTag();
  try {
    libbyLibraryCode = await store.getLibbyLibrary();
  } catch {
    libbyLibraryCode = null; // link just won't render; not worth blocking load over
  }
  renderBacklog();
  renderJournal();
  // Not awaited — these make their own network/storage calls and shouldn't
  // delay first paint; each re-renders itself once done.
  checkForNewTvSeasons();
  checkForUpcomingReleases();
  checkForStaleProgress();
}

el('signOutBtn').addEventListener('click', async () => {
  await store.signOut();
  location.replace('login.html');
});

// Each of the header/filter dropdown toggle buttons calls stopPropagation()
// so its own click doesn't immediately re-trigger the document-level
// outside-click closer below — which also means that closer never gets a
// chance to close any *other* open dropdown when one of these is tapped.
// Call this at the top of each button's handler to close the rest first.
function closeOtherDropdowns(exceptId) {
  ['notifDropdown', 'accountDropdown', 'journalFilterDropdown', 'backlogFilterDropdown']
    .filter((id) => id !== exceptId)
    .forEach((id) => el(id).classList.add('hidden'));
  updateFilterScrim();
}

el('accountBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeOtherDropdowns('accountDropdown');
  el('accountDropdown').classList.toggle('hidden');
});

el('notifBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeOtherDropdowns('notifDropdown');
  const dropdown = el('notifDropdown');
  const opening = dropdown.classList.contains('hidden');
  dropdown.classList.toggle('hidden');
  if (opening) {
    localStorage.setItem(NOTIF_LAST_SEEN_KEY, new Date().toISOString());
    el('notifDot').classList.add('hidden');
  }
});

el('accountStatsBtn').addEventListener('click', () => {
  el('accountDropdown').classList.add('hidden');
  switchTab('account');
  renderAccountPage();
});

el('importExportBtn').addEventListener('click', () => {
  el('accountDropdown').classList.add('hidden');
  openImportExportModal();
});

el('cleanupJournalBtn').addEventListener('click', () => {
  el('accountDropdown').classList.add('hidden');
  openCleanupModal('completed');
});

el('cleanupBacklogBtn').addEventListener('click', () => {
  el('accountDropdown').classList.add('hidden');
  openCleanupModal('wishlist');
});

document.addEventListener('click', (e) => {
  const dropdown = el('accountDropdown');
  if (!dropdown.classList.contains('hidden') && !e.target.closest('.account-menu')) {
    dropdown.classList.add('hidden');
  }
  const notifDropdown = el('notifDropdown');
  if (!notifDropdown.classList.contains('hidden') && !e.target.closest('.notif-menu')) {
    notifDropdown.classList.add('hidden');
  }
});

boot();

// ---------- Tabs ----------

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll(`.tab[data-tab="${tabName}"]`).forEach((b) => b.classList.add('active'));
  el('tab-' + tabName).classList.add('active');
  if (tabName === 'journal' || tabName === 'backlog') {
    el('discoverQuery').value = '';
    el('headerSearchInput').value = '';
  }
  if (tabName !== 'discover' && discoverMergeTargetId) {
    discoverMergeTargetId = null;
    updateDiscoverMergeNotice();
  }
  positionTabIndicator();
}

// Slides the blue background pill behind whichever of Journal/Backlog is
// active. Re-run whenever the active tab changes or the pills' layout
// might have shifted (responsive relocation, window resize).
function positionTabIndicator() {
  const pills = document.querySelector('.tabbar-pills');
  const indicator = el('tabIndicator');
  if (!pills || !indicator) return;
  const activeTab = pills.querySelector('.tab.active');
  if (!activeTab) {
    indicator.style.width = '0';
    return;
  }
  indicator.style.width = `${activeTab.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

el('discoverFabBtn').addEventListener('click', () => {
  el('discoverQuery').focus();
});

// Desktop's persistent header search field: Enter jumps to Discover and
// runs the same search flow as the Discover tab's own search box.
el('headerSearchInput').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const query = e.target.value.trim();
  if (!query) return;
  e.target.blur();
  switchTab('discover');
  el('discoverQuery').value = query;
  runDiscoverSearch();
});

wireRecentSearchDropdown(el('discoverQuery'), el('discoverRecentDropdown'), (query) => {
  el('discoverQuery').value = query;
  runDiscoverSearch();
});
wireRecentSearchDropdown(el('headerSearchInput'), el('headerRecentDropdown'), (query) => {
  switchTab('discover');
  el('discoverQuery').value = query;
  runDiscoverSearch();
});

// ---------- Responsive nav placement ----------
// On desktop, the Journal/Backlog pills live in the header next to the
// title/account icon; on mobile they live in their own fixed bottom bar
// alongside the search button. Physically relocate the pills node rather
// than duplicating it, so its listeners keep working either way. The
// header search field and mobile search button are separate elements
// shown/hidden purely via CSS media query — no relocation needed.

const desktopNavQuery = window.matchMedia('(min-width: 681px)');

function applyResponsiveNav(isDesktop) {
  const pills = document.querySelector('.tabbar-pills');
  const nav = document.querySelector('.tabbar');
  const topbarLeft = el('topbarLeft');

  if (isDesktop) {
    topbarLeft.appendChild(pills);
    nav.classList.add('hidden');
  } else {
    nav.insertBefore(pills, nav.firstChild);
    nav.classList.remove('hidden');
  }
  // Relocating the pills node changes its layout context, so the indicator's
  // measured offsets need to be recalculated afterward.
  positionTabIndicator();
}

applyResponsiveNav(desktopNavQuery.matches);
desktopNavQuery.addEventListener('change', (e) => applyResponsiveNav(e.matches));

let indicatorResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(indicatorResizeTimer);
  indicatorResizeTimer = setTimeout(positionTabIndicator, 100);
});

// ---------- Rendering helpers ----------

function posterOrEmoji(item, sizeClass = 'card-poster') {
  if (item.poster_url) {
    // onerror covers constructed-but-unverified image URLs (e.g. albums'
    // Cover Art Archive links, which 404 for releases with no cover art)
    // falling back to the same plain placeholder used when there's no
    // poster_url at all, instead of a broken-image icon.
    return `<img class="${sizeClass}" src="${escapeHtml(item.poster_url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;${sizeClass}&quot;></div>'">`;
  }
  return `<div class="${sizeClass}"></div>`;
}

function metaLine(item) {
  return [escapeHtml(item.creator), escapeHtml(item.year)].filter(Boolean).join(' · ');
}

// Modals show month + year when the full release date is known (not the
// day — cards stay year-only, see metaLine() above). Parsed as plain
// string components rather than through a Date object: release_date is a
// bare calendar date (no timezone of its own), and asking a UTC-parsed
// Date for its *local* month can roll a date near a month boundary into
// the wrong month depending on the viewer's timezone — the same class of
// bug dateInputToIso()/dateInputValue() already avoid for date pickers.
function modalDateLabel(item) {
  const match = /^(\d{4})-(\d{2})/.exec(item.release_date || '');
  if (match) {
    const monthIdx = parseInt(match[2], 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) return `${MONTH_NAMES[monthIdx]} ${match[1]}`;
  }
  return item.year || null;
}

// Whether release_date actually resolves to a displayable month (same test
// modalDateLabel() above uses) — not just whether the field is non-empty.
// A month-less value (e.g. a bare year from a less-cataloged source) is
// "present" but still needs the same fix as a missing one, so Clean Up's
// gap-detection uses this rather than a plain truthiness check.
function hasReleaseMonth(item) {
  return /^\d{4}-\d{2}/.test(item.release_date || '');
}

// How long to leave a confirmed-not-yet-precise release date alone before
// checking again — long enough to stop nagging about something that isn't
// going to change day to day, short enough to pick it back up once the
// real date is eventually announced.
const RELEASE_DATE_RECHECK_DAYS = 30;

function releaseDateRecentlyChecked(item) {
  if (!item.release_date_checked_at) return false;
  const daysSince = (Date.now() - new Date(item.release_date_checked_at)) / 86400000;
  return daysSince < RELEASE_DATE_RECHECK_DAYS;
}

// The "does this item have an actionable release-date gap" check used
// everywhere Clean Up decides whether to flag/search/re-suggest a fix —
// distinct from hasReleaseMonth() itself, which stays a pure precision
// check and keeps its other jobs unchanged (display formatting in
// modalDateLabel(), the backfill-eligibility guard in applyCleanupMatch(),
// the release-date picker min in minWatchedDateValue()).
function needsReleaseDateFix(item) {
  return !hasReleaseMonth(item) && !releaseDateRecentlyChecked(item);
}

function externalLinkHtml(item) {
  const label = EXTERNAL_LINK_LABEL[item.external_source];
  if (!label || !item.external_url) return '';
  return `<a href="${escapeHtml(item.external_url)}" target="_blank" rel="noopener noreferrer" class="external-link">${label}</a>`;
}

// Libby has no library-agnostic deep link — every search URL is scoped to
// a specific library from the start — so this only renders once the user
// has saved their library's short code (Account → Import/Export → Libby).
// Only offered for backlog books; a finished book has nothing to hold.
function libbyLinkHtml(item) {
  if (item.media_type !== 'book' || item.status !== 'wishlist' || !libbyLibraryCode) return '';
  const query = [item.title, item.creator].filter(Boolean).join(' ');
  const url = `https://libbyapp.com/search/${encodeURIComponent(libbyLibraryCode)}/search/scope-auto/query-${encodeURIComponent(query)}/page-1`;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="external-link">Find on Libby</a>`;
}

function descriptionHtml(text, id) {
  if (!text) return '';
  return `
    <div class="field">
      <p class="modal-description" id="${id}">${escapeHtml(text)}</p>
      <button type="button" class="view-more-btn hidden" id="${id}Toggle">View more</button>
    </div>`;
}

function wireDescriptionToggle(id) {
  const descEl = el(id);
  const toggleBtn = el(id + 'Toggle');
  if (!descEl || !toggleBtn) return;
  requestAnimationFrame(() => {
    if (descEl.scrollHeight > descEl.clientHeight + 1) {
      toggleBtn.classList.remove('hidden');
    }
  });
  toggleBtn.addEventListener('click', () => {
    const expanded = descEl.classList.toggle('expanded');
    toggleBtn.textContent = expanded ? 'View less' : 'View more';
  });
}

function tagPillsHtml(item, { limit } = {}) {
  if (!item.tags || !item.tags.length) return '';
  const tags = limit ? item.tags.slice(0, limit) : item.tags;
  const extra = limit ? item.tags.length - tags.length : 0;
  return `<div class="item-tags">${tags.map((t) => `<span class="tag-pill">${escapeHtml(stripTagEmoji(t))}</span>`).join('')}${extra > 0 ? `<span class="tag-pill tag-pill--more">+${extra}</span>` : ''}</div>`;
}

function tagChipsHtml(id, options, selected) {
  return `<div class="chip-row" id="${id}">${options
    .map((t) => `<button type="button" class="chip${selected.includes(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(stripTagEmoji(t))}</button>`)
    .join('')}</div>`;
}

function wireTagChips(id, onChange) {
  el(id).querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      if (onChange) onChange();
    });
  });
}

function getActiveChipValues(id) {
  return Array.from(el(id).querySelectorAll('.chip.active')).map((c) => c.dataset.value);
}

function tagPoolForType(mediaType) {
  const used = new Set();
  items.forEach((i) => {
    if (i.media_type === mediaType) {
      (i.tags || []).forEach((t) => {
        if (!BACKLOG_TAGS.includes(t)) used.add(t);
      });
    }
  });
  used.delete('❤️ Favorite');
  return ['❤️ Favorite', ...Array.from(used).sort((a, b) => a.localeCompare(b))];
}

function reactionTagsFieldHtml(id, mediaType, selected, extraClass = '') {
  const pool = tagPoolForType(mediaType);
  return `
    <div class="field${extraClass ? ' ' + extraClass : ''}" id="${id}Field">
      <label>Tags</label>
      <div class="chip-row" id="${id}">
        ${pool.map((t) => `<button type="button" class="chip${selected.includes(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(stripTagEmoji(t))}</button>`).join('')}
      </div>
      <div class="tag-add-row">
        <input type="text" id="${id}NewInput" class="tag-add-input" placeholder="Add a tag…" maxlength="24">
        <button type="button" class="btn-secondary tag-add-btn" id="${id}AddBtn">Add</button>
      </div>
    </div>`;
}

function wireReactionTagsField(id, onChange) {
  wireTagChips(id, onChange);
  const container = el(id);
  const input = el(id + 'NewInput');
  const addTag = () => {
    const val = input.value.trim();
    if (!val) return;
    const existing = Array.from(container.querySelectorAll('.chip')).find((c) => c.dataset.value.toLowerCase() === val.toLowerCase());
    if (existing) {
      existing.classList.add('active');
    } else {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip active';
      chip.dataset.value = val;
      chip.textContent = val;
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        if (onChange) onChange();
      });
      container.appendChild(chip);
    }
    input.value = '';
    if (onChange) onChange();
  };
  el(id + 'AddBtn').addEventListener('click', addTag);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  });
}

function hasProgress(item) {
  if (PERCENT_PROGRESS_TYPES.includes(item.media_type)) return item.progress_percent != null;
  if (EPISODE_PROGRESS_TYPES.includes(item.media_type)) return item.progress_season != null || item.progress_episode != null;
  return false;
}

// Season/episode counts for TMDb-sourced TV shows, fetched on demand and
// cached in memory for the session (avoids refetching on every render).
const tvSeasonInfoCache = new Map();

function tmdbTvId(item) {
  if (item.media_type !== 'tv' || item.external_source !== 'tmdb' || !item.external_id) return null;
  const match = /^tv-(\d+)$/.exec(item.external_id);
  return match ? match[1] : null;
}

async function getSeasonInfoCached(item) {
  const tmdbId = tmdbTvId(item);
  if (!tmdbId) return null;
  if (tvSeasonInfoCache.has(tmdbId)) return tvSeasonInfoCache.get(tmdbId);
  const info = await getTVSeasonInfo(tmdbId);
  tvSeasonInfoCache.set(tmdbId, info);
  return info;
}

const seasonEpisodeNamesCache = new Map();

// Group-based shows already carry names on `info.seasons[n].episodeNames`
// (fetched for free alongside counts). Raw-based shows need a lazy,
// per-season fetch — cached so switching back to a season already viewed
// this session doesn't refetch.
async function getEpisodeName(item, info, season, episode) {
  const seasonInfo = info && info.seasons.find((s) => s.seasonNumber === season);
  if (seasonInfo && seasonInfo.episodeNames) return seasonInfo.episodeNames[episode - 1] || null;
  const tmdbId = tmdbTvId(item);
  if (!tmdbId) return null;
  const key = `${tmdbId}-${season}`;
  if (!seasonEpisodeNamesCache.has(key)) {
    seasonEpisodeNamesCache.set(key, getSeasonEpisodeNames(tmdbId, season));
  }
  const names = await seasonEpisodeNamesCache.get(key);
  return names ? names[episode - 1] || null : null;
}

// Completed shows can gain new seasons after you finish them. Once TMDb
// reports a season beyond the one you last watched, move the show back to
// Backlog — rating/notes are left untouched (this isn't a "start over",
// it's "there's more now") — pre-positioned at episode 1 of the new season
// so resuming continues the story instead of rewinding to season 1. Also
// tags it with 🆕 New Season (a BACKLOG_TAGS entry, same lifecycle as
// Shortlist/Recommended: toggleable in the edit modal, filterable in
// Backlog, and auto-stripped once the show is marked watched again).
async function checkForNewTvSeasons() {
  const candidates = items.filter((i) => i.media_type === 'tv' && i.status === 'completed' && tmdbTvId(i));
  let changed = false;
  for (const item of candidates) {
    const info = await getSeasonInfoCached(item);
    if (!info) continue;
    // A show marked watched directly (not via Currently Watching) never had
    // progress_season recorded, so there's no season it can be "behind" —
    // there's no history of what it actually was caught up to. Baseline it
    // to the current count quietly instead of guessing; a real new season
    // will be caught on a later check once this baseline is in place. Same
    // "record now, act on future changes" shape as
    // release_date_checked_at/releaseDateRecentlyChecked() elsewhere in
    // this file.
    if (item.progress_season == null) {
      try {
        const updated = await store.updateItem(item.id, {
          progress_season: info.seasons.length,
          progress_episode: episodeCountForSeason(info, info.seasons.length) || 1,
        });
        const idx = items.findIndex((i) => i.id === item.id);
        if (idx !== -1) items[idx] = updated;
      } catch (err) {
        console.warn('checkForNewTvSeasons: failed to baseline progress_season', item.id, err);
      }
      continue;
    }
    if (info.seasons.length <= item.progress_season) continue;
    try {
      const updated = await store.updateItem(item.id, {
        status: 'wishlist',
        date_completed: null,
        progress_season: item.progress_season + 1,
        progress_episode: 1,
        notified_season_at: new Date().toISOString(),
        tags: [...new Set([...(item.tags || []), '🆕 New Season'])],
      });
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) items[idx] = updated;
      changed = true;
    } catch (err) {
      // Don't let one bad write (e.g. a lagging schema) throw an unhandled
      // rejection and silently take out the rest of the batch — this runs
      // fire-and-forget with no UI to surface an error into.
      console.warn('checkForNewTvSeasons: failed to update', item.id, err);
    }
  }
  if (changed) {
    renderBacklog();
    renderJournal();
  }
}

// TV only for now (books/games could follow the same pattern later).
// Uses each item's own updated_at as the "last progress logged" signal —
// for an in_progress show, nothing but the progress controls themselves
// can change it (see openEditModal's in_progress branch: no tags, notes,
// or rating UI exists for that status), so it's an accurate proxy
// without a dedicated field. Both thresholds are checked independently
// so a user who skips several months entirely still gets the notice
// recorded even though the move fires in the same pass.
const STALE_NOTICE_DAYS = 60;
const STALE_MOVE_DAYS = 90;

async function checkForStaleProgress() {
  const candidates = items.filter((i) => i.media_type === 'tv' && i.status === 'in_progress');
  let changed = false;
  const now = new Date();
  for (const item of candidates) {
    const daysSinceUpdate = Math.floor((now - new Date(item.updated_at)) / 86400000);
    const patch = {};
    if (daysSinceUpdate >= STALE_NOTICE_DAYS && !item.notified_stale_progress_at) {
      patch.notified_stale_progress_at = now.toISOString();
    }
    if (daysSinceUpdate >= STALE_MOVE_DAYS) {
      patch.status = 'wishlist';
      patch.tags = [...new Set([...(item.tags || []), 'Dropped'])];
    }
    if (Object.keys(patch).length === 0) continue;
    try {
      const updated = await store.updateItem(item.id, patch);
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) items[idx] = updated;
      changed = true;
    } catch (err) {
      // Same reasoning as checkForNewTvSeasons(): fire-and-forget, no UI
      // to surface an error into, so one bad write shouldn't kill the batch.
      console.warn('checkForStaleProgress: failed to update', item.id, err);
    }
  }
  if (changed) {
    renderBacklog();
    renderJournal();
  }
}

// Backlog movies and games get a "coming soon" heads-up once, the first
// time the app is opened with 0-7 days left before release — the displayed
// day-count is frozen at that moment (notified_release_soon_days), not
// recomputed on later views — and a separate "out now" heads-up once, the
// first time the app is opened on or shortly after release day. Both use a
// -7..0 day grace window on the "day of" side so opening the app a few
// days late still notifies, without misfiring on old items added long
// after their actual release (no window on the far side would never fire
// at all). TV isn't included here — a show's own premiere uses this same
// release_date/notified_release_* machinery too, but "new season" is the
// notification that matters for shows already in Backlog/Journal, handled
// separately by checkForNewTvSeasons() above.
const RELEASE_NOTIFICATION_TYPES = ['movie', 'game'];

// release_date for movies/games is always a bare "YYYY-MM-DD" (what TMDb/
// RAWG return) — new Date(...) parses that as UTC midnight, which can land
// on the wrong calendar day (and shift the notification windows below by a
// day) for anyone west of UTC. Same underlying issue dateInputValue() below
// already works around for the same reason; parse into local midnight
// instead of routing through new Date() directly.
function localMidnight(dateOnlyStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOnlyStr || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

async function checkForUpcomingReleases() {
  const candidates = items.filter(
    (i) =>
      RELEASE_NOTIFICATION_TYPES.includes(i.media_type) &&
      i.status === 'wishlist' &&
      i.release_date &&
      (!i.notified_release_soon_at || !i.notified_release_day_at)
  );
  let changed = false;
  const now = new Date();
  const todayLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const item of candidates) {
    const releaseDate = localMidnight(item.release_date);
    if (!releaseDate) continue;
    const daysUntilRelease = Math.round((releaseDate - todayLocalMidnight) / (1000 * 60 * 60 * 24));
    const patch = {};
    if (!item.notified_release_soon_at && daysUntilRelease >= 0 && daysUntilRelease <= 7) {
      patch.notified_release_soon_at = now.toISOString();
      patch.notified_release_soon_days = daysUntilRelease;
    }
    if (!item.notified_release_day_at && daysUntilRelease <= 0 && daysUntilRelease >= -7) {
      patch.notified_release_day_at = now.toISOString();
    }
    if (Object.keys(patch).length === 0) continue;
    try {
      const updated = await store.updateItem(item.id, patch);
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) items[idx] = updated;
      changed = true;
    } catch (err) {
      // Same reasoning as checkForNewTvSeasons(): fire-and-forget, no UI to
      // surface an error into, so one bad write shouldn't kill the batch.
      console.warn('checkForUpcomingReleases: failed to update', item.id, err);
    }
  }
  if (changed) {
    renderBacklog();
    renderJournal();
  }
}

function episodeCountForSeason(info, seasonNumber) {
  if (!info) return null;
  const season = info.seasons.find((s) => s.seasonNumber === seasonNumber);
  return season ? season.episodeCount : null;
}

// Once we know a real season/episode count, swap the plain number input for
// a native <select> — on mobile this brings up the OS's number-wheel
// picker, automatically capped to the given range, instead of a keyboard.
function turnIntoSelect(input) {
  const select = document.createElement('select');
  select.id = input.id;
  input.replaceWith(select);
  return select;
}

function setSelectOptions(select, count, selected) {
  select.innerHTML = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return `<option value="${n}"${n === selected ? ' selected' : ''}>${n}</option>`;
  }).join('');
}

function progressFieldHtml(item) {
  if (item.status !== 'in_progress') return '';
  if (PERCENT_PROGRESS_TYPES.includes(item.media_type)) {
    const pct = item.progress_percent || 0;
    return `
      <div class="field">
        <label>Progress</label>
        <div class="progress-row">
          <input type="range" id="editProgressPercent" min="0" max="100" step="1" value="${pct}">
          <input type="number" inputmode="numeric" pattern="[0-9]*" id="editProgressPercentNumber" min="0" max="100" value="${pct}">
          <span class="progress-subtext">%</span>
        </div>
      </div>`;
  }
  if (EPISODE_PROGRESS_TYPES.includes(item.media_type)) {
    const season = item.progress_season || 1;
    const episode = item.progress_episode || 1;
    return `
      <div class="field">
        <label>Progress</label>
        <div class="progress-row">
          <span class="progress-subtext">Season</span>
          <input type="number" inputmode="numeric" pattern="[0-9]*" id="editProgressSeason" min="1" value="${season}">
          <span class="progress-subtext" id="editSeasonTotal"></span>
        </div>
        <div class="progress-row progress-row-episode">
          <span class="progress-subtext">Episode</span>
          <input type="number" inputmode="numeric" pattern="[0-9]*" id="editProgressEpisode" min="1" value="${episode}">
          <span class="progress-subtext" id="editEpisodeTotal"></span>
        </div>
        <p class="progress-subtext" id="editEpisodeName"></p>
      </div>`;
  }
  return '';
}

function cardHtml(item) {
  return `
    <div class="card glass" data-item-id="${item.id}">
      <div class="card-type-badge">${TYPE_LABEL[item.media_type]}</div>
      ${posterOrEmoji(item)}
      <div class="card-body">
        <p class="card-title">${escapeHtml(item.title)}</p>
        <p class="card-meta">${metaLine(item)}</p>
        ${item.rating ? `<div class="card-stars">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</div>` : ''}
        ${tagPillsHtml(item)}
      </div>
    </div>`;
}

function journalEntryHtml(item) {
  const dateStr = item.date_completed
    ? new Date(item.date_completed).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
  const rating = item.rating || 0;
  return `
    <div class="journal-entry glass" data-item-id="${item.id}">
      ${posterOrEmoji(item)}
      <div class="journal-entry-body">
        <div class="journal-entry-header">
          <p class="journal-entry-title">${escapeHtml(item.title)}</p>
          <span class="journal-entry-date">${dateStr}</span>
        </div>
        <p class="journal-entry-meta">${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}</p>
        <div class="journal-entry-rating-row">
          <div class="card-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
          ${tagPillsHtml(item, { limit: 2 })}
        </div>
        ${item.notes ? `<p class="journal-entry-notes">${escapeHtml(item.notes)}</p>` : ''}
      </div>
    </div>`;
}

function findLibraryMatch(result) {
  return items.find((i) => matchesLibraryItem(result, i));
}

function libraryStatusBadgeHtml(match) {
  if (!match) return '';
  if (match.status === 'completed') {
    return `<div class="card-status-badge card-status-badge--done">✓ ${COMPLETED_VERB[match.media_type] || 'Done'}</div>`;
  }
  return `<div class="card-status-badge card-status-badge--saved">✓ Saved</div>`;
}

function manualAddCardHtml() {
  return `
    <div class="card glass card--manual-add" data-manual-add="true">
      <div class="card-manual-add-icon">＋</div>
      <p class="card-title">Add manually</p>
    </div>`;
}

function discoverCardHtml(item, idx) {
  const match = findLibraryMatch(item);
  return `
    <div class="card glass${match && match.status === 'completed' ? ' card--seen' : ''}" data-idx="${idx}">
      <div class="card-type-badge">${TYPE_LABEL[item.media_type]}</div>
      ${libraryStatusBadgeHtml(match)}
      ${posterOrEmoji(item)}
      <div class="card-body">
        <p class="card-title">${escapeHtml(item.title)}</p>
        <p class="card-meta">${metaLine(item)}</p>
      </div>
    </div>`;
}

// ---------- Filtering ----------

function itemYear(item) {
  const y = parseInt(item.year, 10);
  return Number.isNaN(y) ? null : y;
}

function typeMatches(item, selectedTypes) {
  return selectedTypes.size === 0 || selectedTypes.has(item.media_type);
}

// Items with no watched date sort as if they were watched on this sentinel
// date — old enough to fall to the bottom of "newest first" without needing
// a separate undated bucket in the comparator itself.
const NO_DATE_SENTINEL = new Date('1999-01-01T00:00:00.000Z').getTime();
function effectiveCompletedDate(item) {
  return item.date_completed ? new Date(item.date_completed).getTime() : NO_DATE_SENTINEL;
}

// Sorting "by release date" has to use the actual release_date, not just
// itemYear() — comparing years alone left same-year items (e.g. two movies
// both from 2024) in an arbitrary order instead of chronological. Falls
// back to January 1st of the known year when release_date isn't populated
// (older items added before it was tracked for their type), and to the
// same undated sentinel as completed-date sorting when neither is known.
function effectiveReleaseDate(item) {
  if (item.release_date) return new Date(item.release_date).getTime();
  const y = itemYear(item);
  return y ? new Date(y, 0, 1).getTime() : NO_DATE_SENTINEL;
}

const JOURNAL_SORTS = {
  completed_desc: { label: 'Date completed, newest first', cmp: (a, b) => effectiveCompletedDate(b) - effectiveCompletedDate(a) },
  completed_asc: { label: 'Date completed, oldest first', cmp: (a, b) => effectiveCompletedDate(a) - effectiveCompletedDate(b) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => effectiveReleaseDate(b) - effectiveReleaseDate(a) },
  rating_desc: { label: 'Ranking, highest first', cmp: (a, b) => (b.rating || 0) - (a.rating || 0) },
};

const BACKLOG_SORTS = {
  added_desc: { label: 'Date added, newest first', cmp: (a, b) => new Date(b.date_added) - new Date(a.date_added) },
  added_asc: { label: 'Date added, oldest first', cmp: (a, b) => new Date(a.date_added) - new Date(b.date_added) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => effectiveReleaseDate(b) - effectiveReleaseDate(a) },
};

function renderBacklog() {
  const list = items
    .filter((i) => i.status === 'wishlist')
    .filter((i) => typeMatches(i, backlogSelectedTypes))
    .filter((i) => backlogSelectedTags.size === 0 || (i.tags || []).some((t) => backlogSelectedTags.has(t)))
    .sort(BACKLOG_SORTS[backlogSortKey].cmp);
  const grid = el('backlogGrid');
  grid.classList.toggle('card-grid', backlogViewMode === 'grid');
  grid.classList.toggle('journal-feed', backlogViewMode === 'list');
  grid.innerHTML = list.map(backlogViewMode === 'grid' ? cardHtml : backlogEntryHtml).join('');
  el('backlogEmpty').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
  renderNotifications();
  updateBacklogLimitNotice();
}

// Derived from the current filter state rather than a one-off flag from
// whatever action opened this view — so it shows/self-clears correctly
// whether the user landed here via shortlistOverflowRedirect() or just
// filtered here on their own, and disappears the moment they trim the
// category back to the limit.
function updateBacklogLimitNotice() {
  const notice = el('backlogLimitNotice');
  const [singleType] = backlogSelectedTypes;
  const viewingShortlistForOneType =
    backlogSelectedTypes.size === 1 && backlogSelectedTags.size === 1 && backlogSelectedTags.has(SHORTLIST_TAG);
  const overLimit = viewingShortlistForOneType && shortlistCountForType(singleType) > SHORTLIST_LIMIT;
  notice.classList.toggle('hidden', !overLimit);
  notice.textContent = overLimit
    ? `Your Shortlist for ${TYPE_LABEL_PLURAL[singleType]} is over the ${SHORTLIST_LIMIT}-item limit — remove one to make room.`
    : '';
}

// Called after shortlisting a category's (SHORTLIST_LIMIT + 1)th item —
// takes the user straight to the crowded category so they can pick one to
// remove, rather than leaving them to notice the overflow on their own.
function shortlistOverflowRedirect(mediaType) {
  switchTab('backlog');
  backlogSelectedTypes = new Set([mediaType]);
  backlogSelectedTags = new Set([SHORTLIST_TAG]);
  syncFilterUI('backlog');
  renderBacklog();
}

// Backlog's row-layout alternative to cardHtml — reuses Journal's
// horizontal .journal-entry markup/styling rather than introducing a new
// visual language, minus the watched-date/rating/notes fields backlog
// items don't have.
function backlogEntryHtml(item) {
  return `
    <div class="journal-entry glass" data-item-id="${item.id}">
      ${posterOrEmoji(item)}
      <div class="journal-entry-body">
        <div class="journal-entry-header">
          <p class="journal-entry-title">${escapeHtml(item.title)}</p>
        </div>
        <p class="journal-entry-meta">${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}</p>
        ${tagPillsHtml(item)}
      </div>
    </div>`;
}

const BACKLOG_VIEW_ICONS = {
  grid: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="3" width="8" height="8" rx="2"></rect><rect x="3" y="13" width="8" height="8" rx="2"></rect><rect x="13" y="13" width="8" height="8" rx="2"></rect></svg>',
  list: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1.5"></rect><rect x="3" y="10" width="18" height="4" rx="1.5"></rect><rect x="3" y="16" width="18" height="4" rx="1.5"></rect></svg>',
};

function updateBacklogViewToggleBtn() {
  const btn = el('backlogViewToggleBtn');
  btn.innerHTML = BACKLOG_VIEW_ICONS[backlogViewMode];
  btn.setAttribute('aria-label', backlogViewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view');
}

el('backlogViewToggleBtn').addEventListener('click', () => {
  backlogViewMode = backlogViewMode === 'grid' ? 'list' : 'grid';
  updateBacklogViewToggleBtn();
  renderBacklog();
});

function currentlyEntryHtml(item) {
  if (PERCENT_PROGRESS_TYPES.includes(item.media_type)) {
    const pct = item.progress_percent || 0;
    return `
      <div class="currently-card glass" data-item-id="${item.id}">
        <div class="card-type-badge">${TYPE_LABEL[item.media_type]}</div>
        ${posterOrEmoji(item, 'currently-card-poster')}
        <div class="card-body">
          <p class="card-title">${escapeHtml(item.title)}</p>
          <input type="range" class="currently-progress-slider" min="0" max="100" value="${pct}" data-progress-id="${item.id}">
          <div class="currently-progress-row">
            <input type="number" inputmode="numeric" pattern="[0-9]*" class="currently-progress-number" min="0" max="100" value="${pct}" data-progress-number-id="${item.id}">
            <span class="progress-subtext">%</span>
          </div>
        </div>
      </div>`;
  }
  const progressText = `S${item.progress_season || 1} · E${item.progress_episode || 1}`;
  return `
    <div class="currently-card glass" data-item-id="${item.id}">
      <div class="card-type-badge">${TYPE_LABEL[item.media_type]}</div>
      ${posterOrEmoji(item, 'currently-card-poster')}
      <div class="card-body">
        <p class="card-title">${escapeHtml(item.title)}</p>
        <p class="progress-badge" id="progressBadge-${item.id}">${progressText}</p>
        <button type="button" class="btn-secondary next-episode-btn" data-next-episode-id="${item.id}">Next Episode</button>
      </div>
    </div>`;
}

function renderCurrently() {
  const list = items
    .filter((i) => i.status === 'in_progress' && typeMatches(i, journalSelectedTypes))
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const container = el('currentlyContainer');
  const feed = el('currentlyFeed');
  feed.innerHTML = list.map(currentlyEntryHtml).join('');
  container.classList.toggle('hidden', list.length === 0);
  feed.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
  feed.querySelectorAll('[data-next-episode-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.nextEpisodeId;
      const current = items.find((i) => i.id === id);
      const season = current.progress_season || 1;
      const episode = current.progress_episode || 1;
      const info = await getSeasonInfoCached(current);
      const epCount = episodeCountForSeason(info, season);
      const hasNextSeason = info && info.seasons.some((s) => s.seasonNumber === season + 1);
      const patch =
        epCount && episode >= epCount && hasNextSeason
          ? { progress_season: season + 1, progress_episode: 1 }
          : { progress_episode: episode + 1 };
      const updated = await store.updateItem(id, patch);
      const idx = items.findIndex((i) => i.id === id);
      items[idx] = updated;
      renderCurrently();
    });
  });

  list
    .filter((i) => tmdbTvId(i))
    .forEach((i) => {
      getSeasonInfoCached(i).then((info) => {
        if (!info) return;
        const badge = el(`progressBadge-${i.id}`);
        if (!badge) return;
        const season = i.progress_season || 1;
        const episode = i.progress_episode || 1;
        const epCount = episodeCountForSeason(info, season);
        badge.textContent = `S${season} of ${info.seasons.length} · E${episode}${epCount ? ' of ' + epCount : ''}`;
      });
    });

  const clampPct = (v) => Math.min(100, Math.max(0, v));

  feed.querySelectorAll('.currently-progress-slider').forEach((slider) => {
    slider.addEventListener('click', (e) => e.stopPropagation());
    const id = slider.dataset.progressId;
    const number = feed.querySelector(`.currently-progress-number[data-progress-number-id="${id}"]`);
    slider.addEventListener('input', () => {
      number.value = slider.value;
    });
    slider.addEventListener('change', async () => {
      const v = clampPct(parseInt(slider.value, 10) || 0);
      // Hitting 100% means done — mark it completed and go straight to the
      // review modal instead of just sitting at a maxed-out progress bar.
      if (v === 100) {
        await markItemCompleted(items.find((i) => i.id === id), { progress_percent: 100 });
        return;
      }
      const updated = await store.updateItem(id, { progress_percent: v });
      const idx = items.findIndex((i) => i.id === id);
      items[idx] = updated;
      renderCurrently();
    });
  });

  feed.querySelectorAll('.currently-progress-number').forEach((number) => {
    number.addEventListener('click', (e) => e.stopPropagation());
    const id = number.dataset.progressNumberId;
    const slider = feed.querySelector(`.currently-progress-slider[data-progress-id="${id}"]`);
    number.addEventListener('input', () => {
      slider.value = clampPct(parseInt(number.value, 10) || 0);
    });
    number.addEventListener('change', async () => {
      const v = clampPct(parseInt(number.value, 10) || 0);
      number.value = v;
      slider.value = v;
      if (v === 100) {
        await markItemCompleted(items.find((i) => i.id === id), { progress_percent: 100 });
        return;
      }
      const updated = await store.updateItem(id, { progress_percent: v });
      const idx = items.findIndex((i) => i.id === id);
      items[idx] = updated;
      renderCurrently();
    });
  });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// null key = the "No Date" group — kept separate from the 1999 sentinel used
// for sorting so nothing gets a fabricated real-looking date on screen.
function journalDateGroupKey(item) {
  if (!item.date_completed) return null;
  const d = new Date(item.date_completed);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function journalGroupedFeedHtml(list) {
  let html = '';
  let lastGroupId = undefined;
  let lastYearLabel = undefined;
  list.forEach((item) => {
    const key = journalDateGroupKey(item);
    const groupId = key ? `${key.year}-${key.month}` : 'nodate';
    if (groupId !== lastGroupId) {
      const yearLabel = key ? String(key.year) : 'No Date';
      if (yearLabel !== lastYearLabel) {
        html += `<h2 class="section-heading journal-year-heading">${escapeHtml(yearLabel)}</h2>`;
        lastYearLabel = yearLabel;
      }
      if (key) {
        html += `<div class="journal-month-heading"><span>${MONTH_NAMES[key.month]}</span></div>`;
      }
      lastGroupId = groupId;
    }
    html += journalEntryHtml(item);
  });
  return html;
}

function renderJournal() {
  const list = items
    .filter((i) => i.status === 'completed' && typeMatches(i, journalSelectedTypes))
    .filter((i) => journalSelectedTags.size === 0 || (i.tags || []).some((t) => journalSelectedTags.has(t)))
    .filter((i) => journalSelectedRatings.size === 0 || journalSelectedRatings.has(i.rating))
    .sort(JOURNAL_SORTS[journalSortKey].cmp);
  const feed = el('journalFeed');
  const grouped = journalSortKey === 'completed_desc' || journalSortKey === 'completed_asc';
  feed.innerHTML = grouped ? journalGroupedFeedHtml(list) : list.map(journalEntryHtml).join('');
  el('journalEmpty').classList.toggle('hidden', list.length > 0);
  feed.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
  renderCurrently();
  renderNotifications();
}

// Notifications aren't a separate table — each is just a timestamp column
// on the item itself (notified_season_at / notified_release_soon_at /
// notified_release_day_at), set once the first time it fires. That keeps
// them naturally deduped forever without a read/unread flag per event.
// Unread state (the red dot) is tracked separately, in localStorage, since
// it's a lightweight per-device UI preference rather than data that needs
// cross-device sync.
const NOTIF_LAST_SEEN_KEY = 'mediaJournal.notifLastSeenAt';

function notificationEvents() {
  const events = [];
  for (const item of items) {
    if (item.notified_season_at) {
      events.push({ item, at: item.notified_season_at, message: 'New season available' });
    }
    // Release notifications only matter while the item is still sitting in
    // Backlog waiting for it — once it's been started/finished there's
    // nothing left to be notified about. "Out now" is strictly more
    // current than "coming soon", so once both exist only the newer one
    // is shown.
    if (item.status === 'wishlist') {
      if (item.notified_release_day_at) {
        events.push({ item, at: item.notified_release_day_at, message: 'Out now' });
      } else if (item.notified_release_soon_at) {
        const days = item.notified_release_soon_days;
        const message = days === 0 ? 'Out today' : days === 1 ? 'Out in 1 day' : `Out in ${days} days`;
        events.push({ item, at: item.notified_release_soon_at, message });
      }
    }
    if (item.notified_stale_progress_at) {
      events.push({ item, at: item.notified_stale_progress_at, message: `No progress in ${Math.round(STALE_NOTICE_DAYS / 30)} months` });
    }
  }
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events.slice(0, 5);
}

function renderNotifications() {
  const events = notificationEvents();
  const lastSeen = localStorage.getItem(NOTIF_LAST_SEEN_KEY);
  const hasUnread = events.some((e) => !lastSeen || new Date(e.at) > new Date(lastSeen));
  el('notifDot').classList.toggle('hidden', !hasUnread);
  el('notifEmpty').classList.toggle('hidden', events.length > 0);
  const notifList = el('notifList');
  notifList.innerHTML = events
    .map(
      (e) => `
    <button type="button" class="notif-item" data-item-id="${e.item.id}">
      ${posterOrEmoji(e.item, 'notif-item-poster')}
      <div class="notif-item-text">
        <p class="notif-item-title">${escapeHtml(e.item.title)}</p>
        <p class="notif-item-sub">${escapeHtml(e.message)}</p>
      </div>
    </button>`
    )
    .join('');
  notifList.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => {
      el('notifDropdown').classList.add('hidden');
      openEditModal(items.find((i) => i.id === node.dataset.itemId));
    });
  });
}

function wireChipGroup(containerId, onChange) {
  const container = el(containerId);
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      container.dataset.value = chip.dataset.value;
      onChange();
    });
  });
}

function typeChipsHtml(id, selectedTypes) {
  return `<div class="chip-row" id="${id}">${ALL_TYPES.map(
    (t) => `<button type="button" class="chip${selectedTypes.has(t) ? ' active' : ''}" data-value="${t}">${TYPE_EMOJI[t]} ${TYPE_LABEL[t]}</button>`
  ).join('')}</div>`;
}

function wireTypeChips(id, kind) {
  wireTagChips(id, () => {
    const selectedTypes = kind === 'journal' ? journalSelectedTypes : backlogSelectedTypes;
    selectedTypes.clear();
    getActiveChipValues(id).forEach((v) => selectedTypes.add(v));
    syncFilterUI(kind);
    if (kind === 'journal') renderJournal();
    else renderBacklog();
  });
}

function sortOptionsHtml(name, sorts, currentKey) {
  return Object.entries(sorts)
    .map(([key, { label }]) => `<label class="tag-filter-option"><input type="radio" name="${name}" value="${key}" ${key === currentKey ? 'checked' : ''}> ${escapeHtml(label)}</label>`)
    .join('');
}

function renderQuickTags(kind) {
  const selected = kind === 'journal' ? journalSelectedTags : backlogSelectedTags;
  const container = el(`${kind}QuickTags`);
  container.innerHTML = QUICK_TAGS[kind]
    .map((t) => `<button type="button" class="chip${selected.has(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(stripTagEmoji(t))}</button>`)
    .join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleQuickTag(kind, chip.dataset.value));
  });
}

function toggleQuickTag(kind, tag) {
  const selected = kind === 'journal' ? journalSelectedTags : backlogSelectedTags;
  if (selected.has(tag)) selected.delete(tag);
  else selected.add(tag);
  syncFilterUI(kind);
  if (kind === 'journal') renderJournal();
  else renderBacklog();
}

// Keeps the quick chips, the Filter button's "active" dot, and (if open)
// the dropdown's own checkboxes/chips all reflecting the same state,
// regardless of which surface the last change came from.
function syncFilterUI(kind) {
  const selectedTags = kind === 'journal' ? journalSelectedTags : backlogSelectedTags;
  const selectedTypes = kind === 'journal' ? journalSelectedTypes : backlogSelectedTypes;
  const selectedRatings = kind === 'journal' ? journalSelectedRatings : null;

  el(`${kind}QuickTags`).querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('active', selectedTags.has(chip.dataset.value));
  });

  const dropdown = el(`${kind}FilterDropdown`);
  const isOpen = !dropdown.classList.contains('hidden');
  const anyFilterActive = selectedTypes.size > 0 || selectedTags.size > 0 || (selectedRatings && selectedRatings.size > 0);
  el(`${kind}FilterBtn`).classList.toggle('active', isOpen || anyFilterActive);

  if (isOpen) {
    dropdown.querySelectorAll('.chip[data-value]').forEach((chip) => {
      if (ALL_TYPES.includes(chip.dataset.value)) chip.classList.toggle('active', selectedTypes.has(chip.dataset.value));
    });
    dropdown.querySelectorAll('input[data-filter-tag]').forEach((cb) => {
      cb.checked = selectedTags.has(cb.value);
    });
  }
}

function renderBacklogFilterDropdown() {
  const dropdown = el('backlogFilterDropdown');
  dropdown.innerHTML = `
    <div class="tag-filter-section-heading">Categories</div>
    ${typeChipsHtml('backlogFilterTypeChips', backlogSelectedTypes)}
    <div class="tag-filter-section-heading">Tags</div>
    ${BACKLOG_TAGS.map((t) => `<label class="tag-filter-option"><input type="checkbox" data-filter-tag value="${escapeHtml(t)}" ${backlogSelectedTags.has(t) ? 'checked' : ''}> ${escapeHtml(stripTagEmoji(t))}</label>`).join('')}
    <div class="tag-filter-section-heading">Sort by</div>
    ${sortOptionsHtml('backlogSort', BACKLOG_SORTS, backlogSortKey)}
    <button type="button" class="tag-filter-reset" id="backlogFilterReset">Reset filters</button>
  `;

  wireTypeChips('backlogFilterTypeChips', 'backlog');

  dropdown.querySelectorAll('input[data-filter-tag]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) backlogSelectedTags.add(cb.value);
      else backlogSelectedTags.delete(cb.value);
      syncFilterUI('backlog');
      renderBacklog();
    });
  });

  dropdown.querySelectorAll('input[name="backlogSort"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      backlogSortKey = radio.value;
      renderBacklog();
    });
  });

  el('backlogFilterReset').addEventListener('click', (e) => {
    e.stopPropagation();
    backlogSelectedTypes.clear();
    backlogSelectedTags.clear();
    renderBacklogFilterDropdown();
    syncFilterUI('backlog');
    renderBacklog();
  });
}

el('backlogFilterBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeOtherDropdowns('backlogFilterDropdown');
  renderBacklogFilterDropdown();
  el('backlogFilterDropdown').classList.toggle('hidden');
  syncFilterUI('backlog');
  updateFilterScrim();
});

function renderJournalFilterDropdown() {
  const allTags = Array.from(new Set(items.filter((i) => i.status === 'completed').flatMap((i) => i.tags || []))).sort();
  const dropdown = el('journalFilterDropdown');

  const tagsHtml = allTags.length
    ? allTags
        .map(
          (t) =>
            `<label class="tag-filter-option"><input type="checkbox" data-filter-tag value="${escapeHtml(t)}" ${journalSelectedTags.has(t) ? 'checked' : ''}> ${escapeHtml(stripTagEmoji(t))}</label>`
        )
        .join('')
    : `<p class="tag-filter-empty">No tags yet.</p>`;

  const ratingHtml = [5, 4, 3, 2, 1]
    .map(
      (r) =>
        `<label class="tag-filter-option"><input type="checkbox" data-filter-rating value="${r}" ${journalSelectedRatings.has(r) ? 'checked' : ''}> ${'★'.repeat(r)}${'☆'.repeat(5 - r)}</label>`
    )
    .join('');

  dropdown.innerHTML = `
    <div class="tag-filter-section-heading">Categories</div>
    ${typeChipsHtml('journalFilterTypeChips', journalSelectedTypes)}
    <div class="tag-filter-section-heading">Tags</div>
    ${tagsHtml}
    <div class="tag-filter-section-heading">Rating</div>
    ${ratingHtml}
    <div class="tag-filter-section-heading">Sort by</div>
    ${sortOptionsHtml('journalSort', JOURNAL_SORTS, journalSortKey)}
    <button type="button" class="tag-filter-reset" id="journalFilterReset">Reset filters</button>
  `;

  wireTypeChips('journalFilterTypeChips', 'journal');

  dropdown.querySelectorAll('input[data-filter-tag]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) journalSelectedTags.add(cb.value);
      else journalSelectedTags.delete(cb.value);
      syncFilterUI('journal');
      renderJournal();
    });
  });
  dropdown.querySelectorAll('input[data-filter-rating]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const r = parseInt(cb.value, 10);
      if (cb.checked) journalSelectedRatings.add(r);
      else journalSelectedRatings.delete(r);
      syncFilterUI('journal');
      renderJournal();
    });
  });
  dropdown.querySelectorAll('input[name="journalSort"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      journalSortKey = radio.value;
      renderJournal();
    });
  });

  el('journalFilterReset').addEventListener('click', (e) => {
    e.stopPropagation();
    journalSelectedTypes.clear();
    journalSelectedTags.clear();
    journalSelectedRatings.clear();
    renderJournalFilterDropdown();
    syncFilterUI('journal');
    renderJournal();
  });
}

el('journalFilterBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeOtherDropdowns('journalFilterDropdown');
  renderJournalFilterDropdown();
  el('journalFilterDropdown').classList.toggle('hidden');
  syncFilterUI('journal');
  updateFilterScrim();
});

renderQuickTags('journal');
renderQuickTags('backlog');

function updateFilterScrim() {
  const anyOpen = !el('journalFilterDropdown').classList.contains('hidden') || !el('backlogFilterDropdown').classList.contains('hidden');
  el('filterScrim').classList.toggle('hidden', !anyOpen);
}

document.addEventListener('click', (e) => {
  // Only resync here when an outside click actually closes a dropdown.
  // Clicking a tag/rating checkbox *inside* an open dropdown also bubbles
  // to this listener before the checkbox's own 'change' handler fires (click
  // fires, then input/change fire once the click has finished dispatching)
  // — resyncing unconditionally on every click would read backlogSelectedTags/
  // journalSelectedTags before that handler updates them and stamp the
  // checkbox's checked state back to its old value, silently undoing the tap.
  let closedAny = false;
  document.querySelectorAll('.tag-filter-dropdown').forEach((dropdown) => {
    if (!dropdown.classList.contains('hidden') && !e.target.closest('.tag-filter-wrap')) {
      dropdown.classList.add('hidden');
      closedAny = true;
    }
  });
  if (closedAny) {
    syncFilterUI('journal');
    syncFilterUI('backlog');
    updateFilterScrim();
  }
});

// ---------- Stars widget ----------

function starsEditableHtml(id, rating) {
  let html = `<div class="stars" id="${id}" data-rating="${rating || 0}">`;
  for (let v = 1; v <= 5; v++) {
    html += `<button type="button" data-value="${v}" class="${v <= (rating || 0) ? 'filled' : ''}">★</button>`;
  }
  html += `</div>`;
  return html;
}

function wireStars(id, onChange) {
  const container = el(id);
  container.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.value, 10);
      const current = parseInt(container.dataset.rating, 10) || 0;
      const next = val === current ? 0 : val;
      container.dataset.rating = next;
      container.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('filled', parseInt(b.dataset.value, 10) <= next);
      });
      if (onChange) onChange(next);
    });
  });
}

// ---------- Modal ----------

function closeModal() {
  el('modalRoot').innerHTML = '';
}

function openModalWithContent(innerHtml) {
  const openedAt = Date.now();
  el('modalRoot').innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-sheet glass-strong">${innerHtml}</div>
    </div>`;
  el('modalOverlay').addEventListener('click', (e) => {
    // Ignore backdrop clicks in the first moment after opening — a common
    // real-world case is a modal swap after a network round trip (e.g.
    // Mark as Watched -> review modal), where an impatient second tap can
    // land on the new modal's backdrop and instantly, silently close it.
    if (e.target.id === 'modalOverlay' && Date.now() - openedAt > 300) closeModal();
  });
}

// ---------- Clean up Journal / Backlog ----------
// Finds completed items missing a poster, release date, or watched date, or
// backlog items missing a poster or release date — almost every item
// imported from Goodreads/Fable/Letterboxd, since those exports never
// include a poster/description/release date and often omit a per-item
// finish date, plus anything added before release_date tracking existed —
// and offers a one-click auto-matched fix per item, without ever
// overwriting data that's already there.

// Journal items can be missing a poster, release date, or watched date;
// Backlog items have no watched date to speak of, so only poster/release
// date count there.
const CLEANUP_LABELS = {
  completed: { title: 'Clean up Journal', gap: 'a poster, release date, or watched date', gapDone: 'a poster, release date, and watched date' },
  wishlist: { title: 'Clean up Backlog', gap: 'a poster or release date', gapDone: 'a poster and release date' },
};

// A missing release date now counts as a gap too, which — for anyone whose
// library predates that tracking — can mean most or all of it qualifies at
// once. Rendering hundreds of rows (each with a poster) and firing that
// many concurrent searches has been enough to crash the tab on mobile
// Safari, so each run only processes a bounded batch; resolving those and
// reopening Clean Up picks up the next batch (already-resolved items no
// longer match cleanupCandidates(), so nothing repeats).
const CLEANUP_BATCH_SIZE = 40;

function cleanupCandidates(status) {
  return items.filter(
    (i) => i.status === status && (!i.poster_url || needsReleaseDateFix(i) || (status === 'completed' && !i.date_completed))
  );
}

function bestCleanupMatch(item, results) {
  if (!results.length) return null;
  const titleNorm = (item.title || '').trim().toLowerCase();
  const exact = results.filter((r) => (r.title || '').trim().toLowerCase() === titleNorm);
  const pool = (exact.length ? exact : results).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  if (item.year) {
    const yearMatch = pool.find((r) => r.year === item.year);
    if (yearMatch) return yearMatch;
  }
  return pool[0];
}

async function runWithConcurrency(list, limit, fn) {
  const queue = [...list];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift());
    }
  });
  await Promise.all(workers);
}

async function applyCleanupMatch(item, match) {
  const patch = {};
  if (!item.poster_url && match.poster_url) patch.poster_url = match.poster_url;
  if (!item.description && match.description) patch.description = match.description;
  if (!item.year && match.year) patch.year = match.year;
  if (!item.creator && match.creator) patch.creator = match.creator;
  if (!hasReleaseMonth(item) && hasReleaseMonth(match)) patch.release_date = match.release_date;
  const updated = await store.updateItem(item.id, patch);
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx !== -1) items[idx] = updated;
  renderJournal();
  renderBacklog();
  return updated;
}

async function applyCleanupDate(item, iso) {
  const updated = await store.updateItem(item.id, { date_completed: iso });
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx !== -1) items[idx] = updated;
  renderJournal();
  renderBacklog();
  return updated;
}

// "Use this poster" only makes sense when a poster is actually one of this
// row's gaps — a row that already has a poster and is only missing a
// release date gets the more general "Use this match" instead.
function cleanupMatchButtonLabel(needsPoster) {
  return needsPoster ? 'Use this poster' : 'Use this match';
}

function cleanupMatchSuggestionHtml(match, needsPoster) {
  return `
    <div class="cleanup-match-suggestion">
      ${posterOrEmoji(match, 'cleanup-match-poster')}
      <div class="cleanup-match-info">
        <p class="cleanup-match-title">${escapeHtml(match.title)}${match.year ? ` <span class="cleanup-row-year">(${escapeHtml(match.year)})</span>` : ''}</p>
        <div class="cleanup-match-actions">
          <button type="button" class="btn-primary btn-small" data-apply-match>${cleanupMatchButtonLabel(needsPoster)}</button>
          <button type="button" class="btn-ghost btn-small" data-skip-match>Not a match</button>
        </div>
      </div>
    </div>`;
}

function cleanupNoMatchHtml() {
  return `<p class="cleanup-no-match">No automatic match found — <button type="button" class="link-btn" data-open-edit>edit manually</button>.</p>`;
}

// Once every gap a row started with is closed (no date field or match slot
// left in it), drop it from the list so the modal visibly shrinks as items
// get fixed — checked against the row's own remaining fields rather than
// the item's, since Backlog rows never had a date field to begin with.
// The true remaining count is recomputed from cleanupCandidates() (not just
// the rows still on screen), since only a bounded batch is ever rendered —
// see CLEANUP_BATCH_SIZE — so there can be more still waiting than what's
// currently visible.
function maybeRemoveResolvedRow(item) {
  const row = document.querySelector(`.cleanup-row[data-item-id="${item.id}"]`);
  if (row && !row.querySelector('.cleanup-date-field') && !row.querySelector('[data-match-slot]')) {
    row.remove();
  }
  const list = el('cleanupList');
  const shown = list.children.length;
  const status = list.dataset.cleanupStatus;
  const gap = list.dataset.cleanupGap;
  const gapDone = list.dataset.cleanupGapDone;
  const total = cleanupCandidates(status).length;
  if (shown > 0) {
    el('cleanupSubtitle').textContent =
      total > shown
        ? `Showing ${shown} of ${total} items missing ${gap} — resolve these, then reopen to see more.`
        : `${shown} item${shown === 1 ? '' : 's'} missing ${gap}.`;
    return;
  }
  list.classList.add('hidden');
  el('cleanupAllDone').textContent =
    total > 0
      ? `This batch is done — ${total} more item${total === 1 ? '' : 's'} still ${total === 1 ? 'needs' : 'need'} ${gap}. Reopen Clean Up to continue.`
      : `Nothing to clean up — every entry has ${gapDone}.`;
  el('cleanupAllDone').classList.remove('hidden');
}

// Keeps the bulk "use all suggested matches" button's count/disabled state
// in sync with however many rows currently have a match ready to apply.
function updateCleanupApplyAllBtn() {
  const btn = el('cleanupApplyAllBtn');
  if (!btn) return;
  const count = document.querySelectorAll('.cleanup-row [data-apply-match]').length;
  btn.textContent = count ? `Use all suggested matches (${count})` : 'Use all suggested matches';
  btn.disabled = count === 0;
}

// needsPoster/needsReleaseDate are this row's gaps *as of when the slot was
// built* — used to decide whether applying the match actually closed every
// gap it started with, rather than just checking poster_url (which stayed
// true the whole time for a release-date-only row and would've removed the
// slot immediately regardless of whether release_date ever got filled in).
function wireCleanupMatchActions(slot, item, match, needsPoster, needsReleaseDate) {
  slot.querySelector('[data-apply-match]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const updated = await applyCleanupMatch(item, match);
    item = updated;
    const row = document.querySelector(`.cleanup-row[data-item-id="${item.id}"]`);
    if (row) row.querySelector('.cleanup-poster').outerHTML = posterOrEmoji(item, 'cleanup-poster');
    const stillNeedsPoster = needsPoster && !updated.poster_url;
    const stillNeedsReleaseDate = needsReleaseDate && !hasReleaseMonth(updated);
    if (!stillNeedsPoster && !stillNeedsReleaseDate) {
      slot.remove();
    } else {
      const missing = stillNeedsPoster ? 'a poster' : 'a release date';
      slot.innerHTML = `<p class="cleanup-no-match">That match didn't include ${missing} — <button type="button" class="link-btn" data-open-edit>edit manually</button>.</p>`;
      wireCleanupNoMatch(slot, item);
    }
    maybeRemoveResolvedRow(item);
    updateCleanupApplyAllBtn();
  });
  slot.querySelector('[data-skip-match]').addEventListener('click', () => {
    slot.innerHTML = cleanupNoMatchHtml();
    wireCleanupNoMatch(slot, item);
    updateCleanupApplyAllBtn();
  });
}

function wireCleanupNoMatch(slot, item) {
  const btn = slot.querySelector('[data-open-edit]');
  if (btn) btn.addEventListener('click', () => openEditModal(item));
}

async function loadCleanupMatch(item) {
  const slot = document.querySelector(`.cleanup-row[data-item-id="${item.id}"] [data-match-slot]`);
  if (!slot) return;
  // Captured now, before anything changes — these are the gaps this slot
  // was actually built for, independent of whatever the item looks like by
  // the time the match result comes back.
  const needsPoster = !item.poster_url;
  const needsReleaseDate = needsReleaseDateFix(item);
  let match = null;
  try {
    const { results } = await searchExternal(item.title, item.media_type);
    match = bestCleanupMatch(item, results);
  } catch {
    match = null;
  }
  if (!document.body.contains(slot)) return; // row was removed/resolved while the search was in flight

  // A match that's just as imprecise as what's already stored (e.g. an
  // unreleased title TMDb/RAWG itself only has a bare year for) isn't
  // something re-running the same search again is going to improve on.
  // Recording that we checked stops it from being re-suggested as an
  // actionable "Use this match" — which would otherwise apply nothing and
  // just reappear every time Clean Up opens — for a while, then quietly
  // checks again later in case the real date has since been confirmed
  // upstream. No match at all is a different, already-handled case (the
  // existing "No automatic match found" path below) — left alone here.
  if (needsReleaseDate && match && !hasReleaseMonth(match)) {
    try {
      const updated = await store.updateItem(item.id, { release_date_checked_at: new Date().toISOString() });
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) items[idx] = updated;
      item = updated;
    } catch (err) {
      console.warn('loadCleanupMatch: failed to record release_date_checked_at', item.id, err);
    }
    if (!needsPoster) {
      // Nothing else this row could still gain from a match — drop it,
      // same as a fully-resolved row, instead of showing a "fix" that
      // would apply nothing.
      slot.remove();
      maybeRemoveResolvedRow(item);
      updateCleanupApplyAllBtn();
      return;
    }
    // Poster's still missing and this match has one — worth applying for
    // that alone; falls through to the normal render below, which already
    // labels it "Use this poster" (cleanupMatchButtonLabel keys off
    // needsPoster) rather than implying it fixes the date too.
  }

  if (match) {
    slot.innerHTML = cleanupMatchSuggestionHtml(match, needsPoster);
    wireCleanupMatchActions(slot, item, match, needsPoster, needsReleaseDate);
  } else {
    slot.innerHTML = cleanupNoMatchHtml();
    wireCleanupNoMatch(slot, item);
  }
  updateCleanupApplyAllBtn();
}

function cleanupRowHtml(item) {
  const needsPoster = !item.poster_url;
  const needsReleaseDate = needsReleaseDateFix(item);
  const needsDate = item.status === 'completed' && !item.date_completed;
  return `
    <div class="cleanup-row glass" data-item-id="${item.id}">
      ${posterOrEmoji(item, 'cleanup-poster')}
      <div class="cleanup-row-body">
        <p class="cleanup-row-title">${escapeHtml(item.title)}${item.year ? ` <span class="cleanup-row-year">(${escapeHtml(item.year)})</span>` : ''}</p>
        <p class="cleanup-row-meta">${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}</p>
        ${
          needsDate
            ? `<div class="field cleanup-date-field">
                <label>Date ${COMPLETED_VERB[item.media_type] || 'Done'}</label>
                <input type="date" data-cleanup-date min="${minWatchedDateValue(item)}">
              </div>`
            : ''
        }
        ${
          needsPoster || needsReleaseDate
            ? `<div class="cleanup-match-slot" data-match-slot>${
                SEARCHABLE_TYPES.includes(item.media_type)
                  ? '<p class="cleanup-match-loading">Searching for a match…</p>'
                  : cleanupNoMatchHtml()
              }</div>`
            : ''
        }
      </div>
    </div>`;
}

// ---------- Account ----------

// Years that have at least one completed item, plus the current year
// (always included so a brand-new year isn't an empty dropdown), newest
// first — computed fresh every time the modal opens, so it naturally
// keeps up as real years pass with zero maintenance.
function accountYearOptions() {
  const years = new Set([new Date().getFullYear()]);
  items.forEach((i) => {
    if (i.status === 'completed' && i.date_completed) years.add(new Date(i.date_completed).getFullYear());
  });
  return Array.from(years).sort((a, b) => b - a);
}

// Counts of completed items per media type for a given year (or 'all'),
// sorted highest first, omitting types with nothing logged.
function accountStatsForYear(year) {
  const matches = items.filter((i) => {
    if (i.status !== 'completed' || !i.date_completed) return false;
    return year === 'all' || new Date(i.date_completed).getFullYear() === year;
  });
  const counts = {};
  matches.forEach((i) => {
    counts[i.media_type] = (counts[i.media_type] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([type, count]) => ({ type, label: TYPE_LABEL[type] || type, count }))
    .sort((a, b) => b.count - a.count);
}

function accountStatsHtml(year) {
  const stats = accountStatsForYear(year);
  if (!stats.length) {
    return `<p class="empty-state">Nothing logged ${year === 'all' ? 'yet' : `in ${year}`}.</p>`;
  }
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  return `
    <div class="account-stats-list">
      <div class="account-stats-row account-stats-total"><span>Total</span><span class="account-stats-count">${total}</span></div>
      ${stats.map((s) => `<div class="account-stats-row"><span>${escapeHtml(s.label)}</span><span class="account-stats-count">${s.count}</span></div>`).join('')}
    </div>`;
}

// Pure-CSS pie (conic-gradient) + legend, visualizing the exact same
// per-type counts as accountStatsHtml() above for the same selected year —
// no separate year concept here. Colors come from the fixed TYPE_COLOR
// mapping (see its comment) so a type's slice color never changes based on
// what else happens to be present that year.
function accountPieChartHtml(year) {
  const stats = accountStatsForYear(year);
  if (!stats.length) return '';
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  let cumulative = 0;
  const stops = stats
    .map((s) => {
      const from = (cumulative / total) * 100;
      cumulative += s.count;
      const to = (cumulative / total) * 100;
      const color = TYPE_COLOR[s.type] || TYPE_COLOR.other;
      return `${color} ${from}% ${to}%`;
    })
    .join(', ');
  return `
    <div class="account-pie-wrap">
      <div class="account-pie" style="background: conic-gradient(${stops})"></div>
      <div class="account-pie-legend">
        ${stats
          .map(
            (s) => `
          <div class="account-stats-row">
            <span><span class="account-pie-swatch" style="background:${TYPE_COLOR[s.type] || TYPE_COLOR.other}"></span>${escapeHtml(s.label)}</span>
            <span class="account-stats-count">${s.count}</span>
          </div>`
          )
          .join('')}
      </div>
    </div>`;
}

// Count of completed items across one or more media types in one year —
// goal progress is always just this, computed fresh, never a stored
// counter. That's what makes "already marked as watched" and "automatically
// updated" both true for free: nothing to backfill, nothing to increment.
function completedCountForYearTypes(year, mediaTypes) {
  return items.filter(
    (i) => mediaTypes.includes(i.media_type) && i.status === 'completed' && i.date_completed && new Date(i.date_completed).getFullYear() === year
  ).length;
}

function completedCountForYear(year, mediaType) {
  return completedCountForYearTypes(year, [mediaType]);
}

// Goals only ever make sense for the current year or — starting 3 weeks
// out — next year, so you can plan ahead before the calendar flips. Local
// midnight, not UTC (see dateInputToIso()'s reasoning): a plain calendar-day
// countdown shouldn't be timezone-shifted by a few hours near the boundary.
function nextYearGoalEligible() {
  const now = new Date();
  const nextJan1 = new Date(now.getFullYear() + 1, 0, 1);
  return Math.ceil((nextJan1 - now) / (24 * 60 * 60 * 1000)) <= 21;
}

function joinWithAnd(list) {
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function goalTypesLabel(mediaTypes) {
  return joinWithAnd(mediaTypes.map((t) => TYPE_LABEL_PLURAL[t] || t));
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : str;
}

function goalCongratsText(kind, target, mediaTypes) {
  if (kind === 'book') return `Congrats! You finished your reading goal of ${target} books this year.`;
  return `Congrats! You finished your goal of ${target} ${goalTypesLabel(mediaTypes)} this year.`;
}

// Goal cards mimic .currently-card's shape/glass treatment, with the arc
// standing in for the poster slot. Circumference math for a circle of
// radius 50 inside a 120x120 viewBox; the SVG is rotated -90deg (in CSS)
// so the arc starts at 12 o'clock instead of 3 o'clock.
const GOAL_ARC_RADIUS = 50;
const GOAL_ARC_CIRCUMFERENCE = 2 * Math.PI * GOAL_ARC_RADIUS;

function goalArcHtml(target, count) {
  const pct = target ? Math.min(100, (count / target) * 100) : 0;
  const offset = GOAL_ARC_CIRCUMFERENCE * (1 - pct / 100);
  const label = target ? `${count}/${target}` : `${count}/–`;
  return `
    <div class="goal-card-arc-wrap">
      <svg class="goal-arc" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="goal-arc-track" cx="60" cy="60" r="${GOAL_ARC_RADIUS}"></circle>
        <circle class="goal-arc-fill" cx="60" cy="60" r="${GOAL_ARC_RADIUS}" stroke-dasharray="${GOAL_ARC_CIRCUMFERENCE}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="goal-arc-label">${label}</div>
    </div>`;
}

// Once a goal is hit, its card swaps entirely for a green congrats state —
// no arc, just the message and (unless read-only, for a past year) an Edit
// button. The Edit button carries the same data-goal-edit(-id) attribute
// the in-progress card's does, so raising the target back out of reach
// reverts the card on the very next render — nothing extra to wire.
function goalCompletedCardHtml(message, editAttr, readOnly = false) {
  return `
    <div class="goal-card goal-card--completed glass">
      <div class="goal-card-completed-body">
        <p class="goal-congrats-text">${escapeHtml(message)}</p>
        ${readOnly ? '' : `<button type="button" class="btn-secondary btn-small goal-edit-btn" ${editAttr}>Edit</button>`}
      </div>
    </div>`;
}

// The book goal is the one constant, always-present card for the current
// year. Editing happens in place — an inline number input swapped in for
// the Edit button — same convention as before; editing controls which of
// the two is rendered. Past years render read-only (no Edit button at all).
function bookGoalCardHtml(target, count, editing, readOnly = false) {
  if (target && count >= target && !editing) {
    return goalCompletedCardHtml(goalCongratsText('book', target, null), 'data-goal-edit="book"', readOnly);
  }
  const editControl = readOnly
    ? ''
    : editing
      ? `<input type="number" id="goalTargetInput" class="goal-edit-input glass-input" min="1" inputmode="numeric" placeholder="e.g. 12" value="${target || ''}">`
      : `<button type="button" class="btn-secondary btn-small goal-edit-btn" data-goal-edit="book">Edit</button>`;
  return `
    <div class="goal-card glass">
      ${goalArcHtml(target, count)}
      <div class="card-body">
        <p class="card-title">Reading Goal</p>
        ${editControl}
      </div>
    </div>`;
}

// Custom goals are user-defined (any combination of media types) — editing
// always opens the Add/Edit Goal modal rather than an inline input, since
// there's more than just a number to change. Past years render read-only.
function customGoalCardHtml(goal, count, readOnly = false) {
  const { id, target, media_types } = goal;
  if (target && count >= target) {
    return goalCompletedCardHtml(goalCongratsText('custom', target, media_types), `data-goal-edit-id="${id}"`, readOnly);
  }
  return `
    <div class="goal-card glass">
      ${goalArcHtml(target, count)}
      <div class="card-body">
        <p class="card-title">${escapeHtml(capitalize(goalTypesLabel(media_types)))}</p>
        ${readOnly ? '' : `<button type="button" class="btn-secondary btn-small goal-edit-btn" data-goal-edit-id="${id}">Edit</button>`}
      </div>
    </div>`;
}

// Ghost card at the end of the carousel — same visual language as
// Discover's "Add manually" card (dashed border, plus icon), sized to
// match the goal cards around it.
function addGoalCardHtml() {
  return `
    <div class="goal-card glass goal-card--add" data-add-goal="true">
      <div class="goal-card-add-icon">＋</div>
      <p class="card-title">Add Goal</p>
    </div>`;
}

// Renders straight into the #tab-account page (not a modal) — called each
// time the Account item is opened, so it's always built from the current
// in-memory items/user state. Async only for the goals section (a tiny,
// rarely-changing dataset loaded fresh on each visit rather than at app
// boot, since nothing outside this page ever needs it).
async function renderAccountPage() {
  const nameLabel = store.mode === 'demo' ? 'Demo Mode' : (currentUser && currentUser.email) || '';
  const years = accountYearOptions();
  const currentYear = new Date().getFullYear();

  el('accountPageTitle').textContent = nameLabel;
  el('accountYearSelect').innerHTML = `
    ${years.map((y) => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
    <option value="all">All Years</option>
  `;
  el('accountStats').innerHTML = accountStatsHtml(currentYear);
  el('accountPieChart').innerHTML = accountPieChartHtml(currentYear);

  // .onchange (not addEventListener) — this select is a static page element
  // that persists across visits, so re-rendering the page must replace the
  // handler rather than stacking a new one on top each time.
  el('accountYearSelect').onchange = (e) => {
    const year = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    el('accountStats').innerHTML = accountStatsHtml(year);
    el('accountPieChart').innerHTML = accountPieChartHtml(year);
    updateGoalsSection(year);
  };

  // ---- Goals ----
  const goals = await store.listGoals();
  const nextYear = currentYear + 1;

  function renderGoalCarousel(year, bookEditing = false) {
    const bookGoal = goals.find((g) => g.year === year && g.media_type === 'book');
    const customGoals = goals.filter((g) => g.year === year && Array.isArray(g.media_types) && g.media_types.length);

    el('goalCarousel').innerHTML = [
      bookGoalCardHtml(bookGoal ? bookGoal.target : null, completedCountForYear(year, 'book'), bookEditing),
      ...customGoals.map((g) => customGoalCardHtml(g, completedCountForYearTypes(year, g.media_types))),
      addGoalCardHtml(),
    ].join('');

    if (bookEditing) {
      const input = el('goalTargetInput');
      input.focus();
      input.select();
      // Save-on-blur (also triggered by Enter, via input.blur() below) —
      // covers both committing a change and canceling by clicking away,
      // in one handler, so there's no risk of it double-firing against a
      // separate change handler once this re-render removes the input.
      input.onblur = async () => {
        const value = parseInt(input.value, 10);
        if (value && value >= 1) {
          const updated = await store.upsertGoal(year, 'book', value);
          const idx = goals.findIndex((g) => g.year === year && g.media_type === 'book');
          if (idx !== -1) goals[idx] = updated;
          else goals.push(updated);
        }
        renderGoalCarousel(year); // revert to display mode either way
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
      };
    }

    el('goalCarousel').querySelectorAll('[data-goal-edit="book"]').forEach((btn) => {
      btn.onclick = () => renderGoalCarousel(year, true);
    });
    el('goalCarousel').querySelectorAll('[data-goal-edit-id]').forEach((btn) => {
      btn.onclick = () => {
        const goal = customGoals.find((g) => g.id === btn.dataset.goalEditId);
        if (goal) openGoalModal(year, goal);
      };
    });
    const addCard = el('goalCarousel').querySelector('[data-add-goal]');
    if (addCard) addCard.onclick = () => openGoalModal(year, null);
  }

  // Past years are historical — no editing, no adding, just whatever was
  // actually set that year. Returns whether there was anything to show, so
  // the caller can hide the section entirely when there wasn't.
  function renderReadOnlyGoalCards(year) {
    const bookGoal = goals.find((g) => g.year === year && g.media_type === 'book');
    const customGoals = goals.filter((g) => g.year === year && Array.isArray(g.media_types) && g.media_types.length);
    if (!bookGoal && !customGoals.length) return false;

    el('goalCarousel').innerHTML = [
      bookGoal ? bookGoalCardHtml(bookGoal.target, completedCountForYear(year, 'book'), false, true) : '',
      ...customGoals.map((g) => customGoalCardHtml(g, completedCountForYearTypes(year, g.media_types), true)),
    ].join('');
    return true;
  }

  // Add/Edit Goal modal — a multi-select checkbox list of media types plus
  // a target number, shared by both creating a new custom goal and editing
  // an existing one (existing selections/target pre-filled when editing).
  function openGoalModal(year, goal) {
    const editing = !!goal;
    const selectedTypes = new Set(goal ? goal.media_types : []);
    const html = `
      <div class="modal-header">
        <div style="flex:1">
          <p class="modal-title">${editing ? 'Edit Goal' : 'Add Goal'}</p>
        </div>
        <button class="modal-close" id="modalCloseBtn">✕</button>
      </div>
      <div class="field">
        <label>Count toward this goal</label>
        <div class="goal-type-checklist">
          ${ALL_TYPES.map(
            (t) => `
            <label class="tag-filter-option">
              <input type="checkbox" data-goal-modal-type="${t}" value="${t}" ${selectedTypes.has(t) ? 'checked' : ''}>
              ${TYPE_LABEL[t]}
            </label>`
          ).join('')}
        </div>
      </div>
      <div class="field">
        <label for="goalModalTarget">Number of items</label>
        <input type="number" id="goalModalTarget" min="1" inputmode="numeric" placeholder="e.g. 12" value="${goal ? goal.target : ''}">
      </div>
      <div id="goalModalError" class="notice warn hidden"></div>
      <div class="modal-actions">
        <button type="button" class="btn-primary" id="goalModalSaveBtn">Set Goal</button>
      </div>
    `;
    openModalWithContent(html);
    el('modalCloseBtn').addEventListener('click', closeModal);

    function showGoalError(message) {
      const n = el('goalModalError');
      n.textContent = message;
      n.classList.remove('hidden');
    }

    el('goalModalSaveBtn').addEventListener('click', async () => {
      const types = Array.from(document.querySelectorAll('[data-goal-modal-type]:checked')).map((box) => box.value);
      if (!types.length) return showGoalError('Select at least one media type.');
      const target = parseInt(el('goalModalTarget').value, 10);
      if (!target || target < 1) return showGoalError('Enter a target of at least 1.');

      const btn = el('goalModalSaveBtn');
      btn.disabled = true;
      try {
        let saved;
        if (editing) {
          saved = await store.updateGoal(goal.id, types, target);
          const idx = goals.findIndex((g) => g.id === goal.id);
          if (idx !== -1) goals[idx] = saved;
        } else {
          saved = await store.createGoal(year, types, target);
          goals.push(saved);
        }
        closeModal();
        renderGoalCarousel(year);
      } catch (err) {
        btn.disabled = false;
        showGoalError(err.message || 'Could not save that goal — please try again.');
      }
    });
  }

  // Only the current year gets the This Year/Next Year planning-ahead
  // toggle — past years have no "next year" of their own to set up.
  function setupGoalYearToggle() {
    const toggle = el('goalYearToggle');
    if (nextYearGoalEligible()) {
      toggle.classList.remove('hidden');
      toggle.innerHTML = `
        <button type="button" class="chip active" data-value="${currentYear}">This Year</button>
        <button type="button" class="chip" data-value="${nextYear}">Next Year</button>
      `;
      toggle.dataset.value = String(currentYear);
      wireChipGroup('goalYearToggle', () => {
        renderGoalCarousel(parseInt(toggle.dataset.value, 10));
      });
    } else {
      toggle.classList.add('hidden');
      toggle.innerHTML = '';
    }
  }

  // Ties the Goals section to whichever year the rest of the Account page
  // is showing: the current year gets the full editable carousel (plus the
  // This Year/Next Year toggle for planning ahead); any other specific year
  // shows that year's goals read-only, or hides the section entirely if
  // nothing was ever set for it. "All Years" has no single year for goals
  // to apply to, so it hides the section too.
  function updateGoalsSection(year) {
    const section = el('accountGoalSection');
    if (year === 'all') {
      section.classList.add('hidden');
      return;
    }
    if (year === currentYear) {
      section.classList.remove('hidden');
      setupGoalYearToggle();
      renderGoalCarousel(currentYear);
      return;
    }
    el('goalYearToggle').classList.add('hidden');
    el('goalYearToggle').innerHTML = '';
    section.classList.toggle('hidden', !renderReadOnlyGoalCards(year));
  }

  updateGoalsSection(currentYear);
}

function openCleanupModal(status) {
  const labels = CLEANUP_LABELS[status];
  const allCandidates = cleanupCandidates(status);
  const candidates = allCandidates.slice(0, CLEANUP_BATCH_SIZE);
  const subtitleText =
    allCandidates.length > candidates.length
      ? `Showing ${candidates.length} of ${allCandidates.length} items missing ${labels.gap} — resolve these, then reopen to see more.`
      : `${allCandidates.length} item${allCandidates.length === 1 ? '' : 's'} missing ${labels.gap}.`;
  const html = `
    <div class="modal-header">
      <div style="flex:1">
        <p class="modal-title">${labels.title}</p>
        <p class="modal-subtitle" id="cleanupSubtitle">${subtitleText}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${candidates.length ? `<button type="button" class="btn-secondary" id="cleanupApplyAllBtn" style="width:100%;margin-bottom:14px;" disabled>Use all suggested matches</button>` : ''}
    <div id="cleanupList" class="cleanup-list${candidates.length ? '' : ' hidden'}" data-cleanup-status="${status}" data-cleanup-gap="${escapeHtml(labels.gap)}" data-cleanup-gap-done="${escapeHtml(labels.gapDone)}">${candidates.map(cleanupRowHtml).join('')}</div>
    <p id="cleanupAllDone" class="empty-state${candidates.length ? ' hidden' : ''}">Nothing to clean up — every entry has ${labels.gapDone}.</p>
  `;
  openModalWithContent(html);
  el('modalCloseBtn').addEventListener('click', closeModal);

  const applyAllBtn = el('cleanupApplyAllBtn');
  if (applyAllBtn) {
    applyAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.cleanup-row [data-apply-match]').forEach((btn) => btn.click());
    });
  }

  el('cleanupList').querySelectorAll('[data-cleanup-date]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const row = e.target.closest('.cleanup-row');
      const itemId = row.dataset.itemId;
      const item = items.find((i) => i.id === itemId);
      if (!item || !e.target.value) return;
      const updated = await applyCleanupDate(item, dateInputToIso(e.target.value));
      row.querySelector('.cleanup-date-field').remove();
      maybeRemoveResolvedRow(updated);
    });
  });

  el('cleanupList').querySelectorAll('.cleanup-row [data-match-slot] [data-open-edit]').forEach((btn) => {
    const item = items.find((i) => i.id === btn.closest('.cleanup-row').dataset.itemId);
    if (item) wireCleanupNoMatch(btn.closest('[data-match-slot]'), item);
  });

  const searchable = candidates.filter((i) => (!i.poster_url || needsReleaseDateFix(i)) && SEARCHABLE_TYPES.includes(i.media_type));
  runWithConcurrency(searchable, 3, loadCleanupMatch);
}

// ---------- Import / Export ----------

async function openImportExportModal() {
  const html = `
    <div class="modal-header">
      <div style="flex:1">
        <p class="modal-title">Import / Export</p>
        <p class="modal-subtitle">Bring in your history from another tracker, or back up your data.</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <div class="field">
      <label>Export</label>
      <button type="button" class="btn-secondary" id="exportJsonBtn" style="width:100%;">Export my data (JSON)</button>
    </div>
    <div class="field">
      <label>Import from Goodreads</label>
      <p class="modal-subtitle" style="margin:0 0 8px;">Export your library at <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener">goodreads.com/review/import</a> → "Export Library", then upload the .csv here.</p>
      <input type="file" accept=".csv" id="goodreadsFile">
    </div>
    <div class="field">
      <label>Import from Fable</label>
      <p class="modal-subtitle" style="margin:0 0 8px;">Fable has no built-in export — use a browser extension such as "Fable Xport" to generate a Goodreads-style .csv, then upload it here.</p>
      <input type="file" accept=".csv" id="fableFile">
    </div>
    <div class="field">
      <label>Import from Letterboxd</label>
      <p class="modal-subtitle" style="margin:0 0 8px;">Export your data at <a href="https://letterboxd.com/user/exportdata/" target="_blank" rel="noopener">letterboxd.com/user/exportdata</a>, then upload the .zip here as-is.</p>
      <input type="file" accept=".zip" id="letterboxdFile">
    </div>
    <div class="field">
      <label>Libby</label>
      <p class="modal-subtitle" style="margin:0 0 8px;">Your library's short code — find it in the Libby app under your library card, or in the URL when you search on <a href="https://libbyapp.com" target="_blank" rel="noopener">libbyapp.com</a>. Once saved, backlog books get a "Find on Libby" link.</p>
      <input type="text" id="libbyLibraryInput" placeholder="Library code" value="${escapeHtml(libbyLibraryCode || '')}">
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="saveLibbyLibraryBtn" style="width:100%;">Save</button>
      </div>
    </div>
    <div id="importNotice" class="notice warn hidden"></div>
  `;
  openModalWithContent(html);
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('exportJsonBtn').addEventListener('click', () => exportAsJson(items));

  function showImportError(err) {
    const n = el('importNotice');
    if (!n) return;
    n.textContent = err.message || 'Could not read that file.';
    n.classList.remove('hidden');
  }

  el('goodreadsFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      openImportPreviewModal('Goodreads', parseGoodreadsCsv(await file.text()));
    } catch (err) {
      showImportError(err);
    }
  });

  el('fableFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      openImportPreviewModal('Fable', parseFableCsv(await file.text()));
    } catch (err) {
      showImportError(err);
    }
  });

  el('letterboxdFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      openImportPreviewModal('Letterboxd', await parseLetterboxdZip(await file.arrayBuffer()));
    } catch (err) {
      showImportError(err);
    }
  });

  el('saveLibbyLibraryBtn').addEventListener('click', async () => {
    const value = el('libbyLibraryInput').value.trim();
    if (!value) return showImportError(new Error('Enter your library code first.'));
    const btn = el('saveLibbyLibraryBtn');
    btn.disabled = true;
    try {
      libbyLibraryCode = await store.setLibbyLibrary(value);
    } catch (err) {
      showImportError(err);
    } finally {
      btn.disabled = false;
    }
  });
}

function openImportPreviewModal(sourceLabel, parsedItems) {
  const { toAdd, skipped } = dedupeAgainstLibrary(parsedItems, items);
  const html = `
    <div class="modal-header">
      <div style="flex:1">
        <p class="modal-title">Import from ${sourceLabel}</p>
        <p class="modal-subtitle">${toAdd.length} item${toAdd.length === 1 ? '' : 's'} to import${skipped.length ? `, ${skipped.length} already in your library will be skipped` : ''}.</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${
      toAdd.length
        ? `<div class="modal-actions">
            <button type="button" class="btn-secondary" id="cancelImportBtn" style="width:100%;">Cancel</button>
            <button type="button" class="btn-primary" id="confirmImportBtn" style="width:100%;">Import ${toAdd.length} item${toAdd.length === 1 ? '' : 's'}</button>
          </div>`
        : `<p class="empty-state">Nothing new to import — everything in this file is already in your library.</p>
           <button type="button" class="btn-secondary" id="cancelImportBtn" style="width:100%;">Close</button>`
    }
  `;
  openModalWithContent(html);
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('cancelImportBtn').addEventListener('click', closeModal);
  const confirmBtn = el('confirmImportBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Importing…';
      const added = await store.addItems(toAdd);
      items = [...items, ...added];
      renderBacklog();
      renderJournal();
      openImportResultModal(sourceLabel, added.length);
    });
  }
}

function openImportResultModal(sourceLabel, count) {
  const html = `
    <div class="modal-header">
      <div style="flex:1">
        <p class="modal-title">Import complete</p>
        <p class="modal-subtitle">Added ${count} item${count === 1 ? '' : 's'} from ${sourceLabel}.</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <button type="button" class="btn-primary" id="doneImportBtn" style="width:100%;">Done</button>
  `;
  openModalWithContent(html);
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('doneImportBtn').addEventListener('click', closeModal);
}

function openEditModal(item) {
  let current = item;

  const html = `
    <div class="modal-header">
      ${posterOrEmoji(current, 'modal-poster')}
      <div style="flex:1">
        <p class="modal-title">${escapeHtml(current.title)}</p>
        <p class="modal-subtitle">${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${modalDateLabel(current) ? ' · ' + escapeHtml(modalDateLabel(current)) : ''}</p>
        ${current.media_type === 'tv' ? `<p class="modal-subtitle" id="modalSeasonCount"></p>` : ''}
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    <div class="modal-links">${externalLinkHtml(current)}${libbyLinkHtml(current)}</div>
    ${descriptionHtml(current.description, 'editDescription')}
    ${
      (current.status === 'wishlist' || current.status === 'completed') && (!current.poster_url || needsReleaseDateFix(current))
        ? `<button type="button" class="btn-secondary" id="updateInfoBtn" style="width:100%;margin-bottom:12px;">Update Info</button>`
        : ''
    }
    ${
      current.status === 'wishlist'
        ? `<div class="field" id="backlogTagField"><label>Tags</label>${tagChipsHtml('editBacklogTagChips', backlogTagsFor(current.media_type), current.tags || [])}</div>`
        : ''
    }
    ${
      current.status === 'wishlist' && PROGRESS_TYPES.includes(current.media_type)
        ? `<button type="button" class="btn-secondary" id="startProgressBtn" style="width:100%;margin-bottom:12px;">${START_LABEL[current.media_type]}</button>`
        : ''
    }
    ${progressFieldHtml(current)}
    ${
      current.status === 'completed'
        ? `
          <div class="field">
            <label>Your review</label>
            <div class="card-stars" style="font-size:18px;">${'★'.repeat(current.rating || 0)}${'☆'.repeat(5 - (current.rating || 0))}</div>
            ${tagPillsHtml(current)}
            ${current.notes ? `<p class="journal-entry-notes" style="-webkit-line-clamp:unset;margin:8px 0 0;">${escapeHtml(current.notes)}</p>` : ''}
            <button type="button" class="btn-secondary" id="editReviewBtn" style="width:100%;margin-top:12px;">Edit Review</button>
            <button type="button" class="btn-ghost" id="unmarkBtn" style="width:100%;margin-top:4px;">${hasProgress(current) ? '↩ Move back to Currently Reading/Watching' : '↩ Move back to Backlog'}</button>
          </div>
        `
        : current.status === 'in_progress'
        ? `
          <button type="button" class="btn-secondary" id="updateProgressBtn" style="width:100%;margin-bottom:12px;">Update</button>
          <button type="button" class="btn-primary" id="markWatchedBtn" style="width:100%;margin-bottom:12px;">✓ Finished</button>
        `
        : `<button type="button" class="btn-primary" id="markWatchedBtn" style="width:100%;margin-bottom:12px;">✓ Mark as ${COMPLETED_VERB[current.media_type] || 'Done'}</button>`
    }
    <div class="modal-actions">
      <button class="btn-danger" id="deleteBtn" style="width:100%;">Remove</button>
    </div>
  `;
  openModalWithContent(html);
  wireDescriptionToggle('editDescription');
  el('modalCloseBtn').addEventListener('click', closeModal);

  const updateInfoBtn = el('updateInfoBtn');
  if (updateInfoBtn) {
    updateInfoBtn.addEventListener('click', () => {
      closeModal();
      startDiscoverMerge(current);
    });
  }

  if (current.media_type === 'tv') {
    getSeasonInfoCached(current).then((info) => {
      const seasonCountEl = el('modalSeasonCount');
      if (!info || !seasonCountEl) return;
      const n = info.seasons.length;
      seasonCountEl.textContent = `${n} Season${n === 1 ? '' : 's'}`;
    });
  }

  async function persist(patch) {
    const updated = await store.updateItem(current.id, patch);
    current = updated;
    const idx = items.findIndex((i) => i.id === current.id);
    if (idx !== -1) items[idx] = updated;
    renderBacklog();
    renderJournal();
    return updated;
  }

  if (current.status === 'in_progress' && PERCENT_PROGRESS_TYPES.includes(current.media_type)) {
    const slider = el('editProgressPercent');
    const number = el('editProgressPercentNumber');
    const clampPct = (v) => Math.min(100, Math.max(0, v));

    slider.addEventListener('input', (e) => {
      number.value = e.target.value;
    });
    slider.addEventListener('change', (e) => {
      const v = clampPct(parseInt(e.target.value, 10) || 0);
      // Hitting 100% means done — mark it completed and go straight to the
      // review modal instead of just sitting at a maxed-out progress bar.
      if (v === 100) markItemCompleted(current, { progress_percent: 100 });
      else persist({ progress_percent: v });
    });

    number.addEventListener('input', (e) => {
      slider.value = clampPct(parseInt(e.target.value, 10) || 0);
    });
    number.addEventListener('change', (e) => {
      const v = clampPct(parseInt(e.target.value, 10) || 0);
      number.value = v;
      slider.value = v;
      if (v === 100) markItemCompleted(current, { progress_percent: 100 });
      else persist({ progress_percent: v });
    });
  }
  if (current.status === 'in_progress' && EPISODE_PROGRESS_TYPES.includes(current.media_type)) {
    el('editProgressSeason').addEventListener('change', (e) => {
      persist({ progress_season: parseInt(e.target.value, 10) || 1 });
    });
    el('editProgressEpisode').addEventListener('change', (e) => {
      persist({ progress_episode: parseInt(e.target.value, 10) || 1 });
    });

    getSeasonInfoCached(current).then((info) => {
      const seasonInputEl = el('editProgressSeason');
      if (!info || !seasonInputEl) return;
      const episodeInputEl = el('editProgressEpisode');
      const seasonTotal = el('editSeasonTotal');
      const episodeTotal = el('editEpisodeTotal');
      seasonTotal.textContent = `of ${info.seasons.length}`;

      const seasonSelect = turnIntoSelect(seasonInputEl);
      setSelectOptions(seasonSelect, info.seasons.length, parseInt(seasonInputEl.value, 10) || 1);

      // Guards against a slower earlier lookup (e.g. a raw-breakdown show's
      // lazy per-season fetch) resolving after a newer season/episode
      // change and clobbering the name with stale data.
      let episodeNameRequestId = 0;
      const updateEpisodeName = () => {
        const nameEl = el('editEpisodeName');
        if (!nameEl) return;
        const seasonNum = parseInt(seasonSelect.value, 10) || 1;
        const episodeNum = parseInt((episodeSelect || episodeInputEl).value, 10) || 1;
        const requestId = ++episodeNameRequestId;
        getEpisodeName(current, info, seasonNum, episodeNum).then((name) => {
          if (requestId !== episodeNameRequestId) return;
          nameEl.textContent = name || '';
        });
      };

      let episodeSelect = null;
      const updateEpisodeOptions = () => {
        const epCount = episodeCountForSeason(info, parseInt(seasonSelect.value, 10) || 1);
        episodeTotal.textContent = epCount ? `of ${epCount}` : '';
        if (!epCount) return;
        const currentEpisode = Math.min(parseInt((episodeSelect || episodeInputEl).value, 10) || 1, epCount);
        if (!episodeSelect) episodeSelect = turnIntoSelect(episodeInputEl);
        setSelectOptions(episodeSelect, epCount, currentEpisode);
        episodeSelect.onchange = (e) => {
          persist({ progress_episode: parseInt(e.target.value, 10) || 1 });
          updateEpisodeName();
        };
      };
      updateEpisodeOptions();
      updateEpisodeName();

      seasonSelect.addEventListener('change', (e) => {
        persist({ progress_season: parseInt(e.target.value, 10) || 1 });
        updateEpisodeOptions();
        updateEpisodeName();
      });
    });
  }

  const startBtn = el('startProgressBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      // A show cycled back to Backlog after a new season dropped already
      // has progress_season/progress_episode set (pointing at the new
      // season, episode 1) — only default to season 1 for a show that's
      // never been started at all.
      const patch = PERCENT_PROGRESS_TYPES.includes(current.media_type)
        ? { status: 'in_progress', progress_percent: 0 }
        : { status: 'in_progress', progress_season: current.progress_season || 1, progress_episode: current.progress_episode || 1 };
      await persist(patch);
      closeModal();
      switchTab('journal');
    });
  }

  if (current.status === 'wishlist') {
    wireTagChips('editBacklogTagChips', () => {
      const newTags = getActiveChipValues('editBacklogTagChips');
      const justShortlisted = newTags.includes(SHORTLIST_TAG) && !(current.tags || []).includes(SHORTLIST_TAG);
      const overLimit = justShortlisted && shortlistCountForType(current.media_type) >= SHORTLIST_LIMIT;
      const mediaType = current.media_type;
      persist({ tags: newTags }).then(() => {
        if (overLimit) {
          closeModal();
          shortlistOverflowRedirect(mediaType);
        }
      });
    });
  }

  const updateProgressBtn = el('updateProgressBtn');
  if (updateProgressBtn) {
    // Progress fields already autosave on change (see the wireStars/
    // slider/select listeners above) — this is just a dismiss action for
    // people who expect an explicit "save and close" button.
    updateProgressBtn.addEventListener('click', () => closeModal());
  }

  const markBtn = el('markWatchedBtn');
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      markBtn.disabled = true;
      try {
        await markItemCompleted(current);
      } catch (err) {
        markBtn.disabled = false;
        alert(err.message || 'Could not save that — please try again.');
      }
    });
  }

  const editReviewBtn = el('editReviewBtn');
  if (editReviewBtn) {
    editReviewBtn.addEventListener('click', () => openReviewModalSafely(current));
  }

  const unmarkBtn = el('unmarkBtn');
  if (unmarkBtn) {
    unmarkBtn.addEventListener('click', async () => {
      await persist({
        status: hasProgress(current) ? 'in_progress' : 'wishlist',
        date_completed: null,
        rating: null,
      });
      closeModal();
    });
  }

  el('deleteBtn').addEventListener('click', async () => {
    if (!confirm(`Remove "${current.title}" from your ${current.status === 'wishlist' ? 'backlog' : 'journal'}?`)) return;
    await store.deleteItem(current.id);
    items = items.filter((i) => i.id !== current.id);
    renderBacklog();
    renderJournal();
    closeModal();
  });
}

// A <input type="date"> value is a plain calendar date with no timezone —
// encode/decode it via *local* midnight (not UTC) so the round trip is
// lossless regardless of the browser's UTC offset. Everywhere this
// timestamp gets displayed back (toLocaleDateString, getFullYear/getMonth)
// already reads in local time, so a UTC-encoded midnight would land on the
// wrong calendar day for about half the world's timezones.
function dateInputValue(iso) {
  if (!iso) return '';
  // A bare date-only string (release_date is a Postgres `date` column,
  // sometimes just "YYYY-MM" for partial book/album dates) has no
  // timezone to begin with — extract its digits directly rather than
  // routing it through new Date(), which parses a date-only string as
  // UTC midnight and can land on the wrong calendar day for anyone west
  // of UTC. A full timestamp (date_completed always has a time
  // component) doesn't match this and falls through unchanged below.
  const dateOnly = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3] || '01'}`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateInputToIso(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}

// A month-less release_date isn't precise enough to justify blocking
// dates against (same bar hasReleaseMonth() already sets elsewhere for
// "is this release_date usable") — no min in that case, same as today.
function minWatchedDateValue(item) {
  return hasReleaseMonth(item) ? dateInputValue(item.release_date) : '';
}

function openReviewModal(item) {
  let current = item;

  const html = `
    <div class="modal-header">
      ${posterOrEmoji(current, 'modal-poster')}
      <div style="flex:1">
        <p class="modal-title">${escapeHtml(current.title)}</p>
        <p class="modal-subtitle">${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${modalDateLabel(current) ? ' · ' + escapeHtml(modalDateLabel(current)) : ''}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(current)}
    <div class="field">
      <label>Your rating</label>
      ${starsEditableHtml('reviewStars', current.rating)}
    </div>
    <div class="field">
      <label for="reviewDateCompleted">Date ${COMPLETED_VERB[current.media_type] || 'Done'}</label>
      <input type="date" id="reviewDateCompleted" value="${dateInputValue(current.date_completed)}" min="${minWatchedDateValue(current)}">
    </div>
    ${reactionTagsFieldHtml('reviewTagChips', current.media_type, current.tags || [])}
    <div class="field">
      <label for="reviewNotes">Notes</label>
      <textarea id="reviewNotes" placeholder="Thoughts, quotes, where you left off…">${escapeHtml(current.notes || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-primary" id="reviewDoneBtn" style="width:100%">Add to Journal</button>
    </div>
  `;
  openModalWithContent(html);
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('reviewDoneBtn').addEventListener('click', () => {
    switchTab('journal');
    closeModal();
  });

  async function persist(patch) {
    const updated = await store.updateItem(current.id, patch);
    current = updated;
    const idx = items.findIndex((i) => i.id === current.id);
    if (idx !== -1) items[idx] = updated;
    renderBacklog();
    renderJournal();
  }

  wireStars('reviewStars', (rating) => {
    persist({ rating: rating || null });
  });

  el('reviewDateCompleted').addEventListener('change', (e) => {
    persist({ date_completed: dateInputToIso(e.target.value) });
  });

  wireReactionTagsField('reviewTagChips', () => {
    persist({ tags: getActiveChipValues('reviewTagChips') });
  });

  el('reviewNotes').addEventListener('blur', () => {
    const val = el('reviewNotes').value.trim() || null;
    if (val === current.notes) return;
    persist({ notes: val });
  });
}

// Discover's results grid (up to a couple dozen poster images) stays fully
// mounted behind the Add modal — switching tabs only hides it with CSS, it
// isn't actually removed until the next search overwrites it. Saving an
// item immediately triggers a full renderBacklog()/renderJournal() rebuild
// (real poster images for the destination list too), so for anyone with a
// large library this is real, avoidable memory pressure stacking right on
// top of that rebuild, at exactly the moment it matters least — the same
// category of problem CLEANUP_BATCH_SIZE exists to avoid for Clean Up.
// Every action here always navigates away from Discover, so there's
// nothing lost by dropping it now instead of waiting for the next search.
function freeDiscoverResults() {
  el('discoverResults').innerHTML = '';
  el('discoverEmpty').classList.remove('hidden');
}

function openAddModal(prefill = {}) {
  const isManual = !prefill.title;
  const posterBlock = prefill.poster_url
    ? `<img class="modal-poster" src="${escapeHtml(prefill.poster_url)}" alt="">`
    : `<div class="modal-poster" style="background:rgba(120,120,128,0.12)"></div>`;

  const html = `
    <div class="modal-header">
      ${posterBlock}
      <div style="flex:1">
        <p class="modal-title">${isManual ? 'Add something new' : escapeHtml(prefill.title)}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(prefill)}
    ${descriptionHtml(prefill.description, 'addDescription')}
    <div class="field">
      <label for="addTitle">Title</label>
      <input type="text" id="addTitle" value="${escapeHtml(prefill.title || '')}" required>
    </div>
    <div class="field">
      <label for="addType">Type</label>
      <select id="addType">
        ${Object.keys(TYPE_LABEL).map((t) => `<option value="${t}" ${t === prefill.media_type ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="addCreator">Creator / Author / Director</label>
      <input type="text" id="addCreator" value="${escapeHtml(prefill.creator || '')}">
    </div>
    <div class="field">
      <label for="addYear">Year</label>
      <input type="text" id="addYear" value="${escapeHtml(prefill.year || '')}">
    </div>
    <div id="addModalError" class="notice warn hidden"></div>
    <div class="modal-actions stack">
      <button type="button" class="btn-secondary" id="addBacklogBtn">+ Add to Backlog</button>
      <button type="button" class="btn-secondary hidden" id="addCurrentlyBtn">Currently Reading</button>
      <button type="button" class="btn-primary" id="addWatchedBtn">✓ Mark as Watched</button>
    </div>
  `;
  openModalWithContent(html);
  wireDescriptionToggle('addDescription');
  el('modalCloseBtn').addEventListener('click', closeModal);

  function showAddError(err) {
    const n = el('addModalError');
    if (!n) return;
    n.textContent = err.message || 'Could not save that item — please try again.';
    n.classList.remove('hidden');
  }

  function currentDraft() {
    const type = el('addType').value;
    return {
      media_type: type,
      title: el('addTitle').value.trim(),
      creator: el('addCreator').value.trim() || null,
      year: el('addYear').value.trim() || null,
      poster_url: prefill.poster_url || null,
      description: prefill.description || null,
      external_source: prefill.external_source || 'manual',
      external_id: prefill.external_id || null,
      external_url: prefill.external_url || null,
      release_date: prefill.release_date || null,
    };
  }

  function updateActionButtons() {
    const type = el('addType').value;
    el('addWatchedBtn').textContent = `✓ Mark as ${COMPLETED_VERB[type] || 'Done'}`;
    const eligible = PROGRESS_TYPES.includes(type);
    el('addCurrentlyBtn').classList.toggle('hidden', !eligible);
    if (eligible) el('addCurrentlyBtn').textContent = CURRENTLY_LABEL[type];
  }
  updateActionButtons();
  el('addType').addEventListener('change', updateActionButtons);

  el('addBacklogBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    // Disabled for the duration of the save so a slow connection + a
    // second tap can't fire this twice and create a duplicate item.
    const btn = el('addBacklogBtn');
    btn.disabled = true;
    try {
      const saved = await store.addItem({ ...draft, status: 'wishlist' });
      items.unshift(saved);
      freeDiscoverResults();
      renderBacklog();
      renderJournal();
      closeModal();
      switchTab('backlog');
    } catch (err) {
      btn.disabled = false;
      showAddError(err);
    }
  });

  el('addCurrentlyBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    const btn = el('addCurrentlyBtn');
    btn.disabled = true;
    try {
      const progress = PERCENT_PROGRESS_TYPES.includes(draft.media_type) ? { progress_percent: 0 } : { progress_season: 1, progress_episode: 1 };
      const saved = await store.addItem({ ...draft, status: 'in_progress', ...progress });
      items.unshift(saved);
      freeDiscoverResults();
      renderBacklog();
      renderJournal();
      closeModal();
      switchTab('journal');
    } catch (err) {
      btn.disabled = false;
      showAddError(err);
    }
  });

  el('addWatchedBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    const btn = el('addWatchedBtn');
    btn.disabled = true;
    try {
      const saved = await store.addItem({
        ...draft,
        status: 'completed',
        rating: null,
        tags: [],
        notes: null,
        date_completed: new Date().toISOString(),
      });
      items.unshift(saved);
      freeDiscoverResults();
      renderBacklog();
      renderJournal();
      switchTab('journal');
      openReviewModalSafely(saved);
    } catch (err) {
      btn.disabled = false;
      showAddError(err);
    }
  });
}

// Shared "mark as completed" step, used both by the explicit Finished
// button and by progress hitting 100% automatically — one write (merging
// in any extra fields, e.g. the progress value that triggered it), then
// routes to the review modal exactly like tapping Finished would.
async function markItemCompleted(item, extraPatch = {}) {
  const updated = await store.updateItem(item.id, {
    ...extraPatch,
    status: 'completed',
    date_completed: item.date_completed || new Date().toISOString(),
    tags: (item.tags || []).filter((t) => !BACKLOG_TAGS.includes(t)),
  });
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx !== -1) items[idx] = updated;
  renderBacklog();
  renderJournal();
  switchTab('journal');
  openReviewModalSafely(updated);
  return updated;
}

// The item is already safely saved by the time this runs — if building the
// review UI itself fails for some reason, don't leave the user stranded
// wondering whether the save even happened.
function openReviewModalSafely(item) {
  try {
    openReviewModal(item);
  } catch (err) {
    console.error('Failed to open the review modal:', err);
    closeModal();
    showFallbackNotice(`"${item.title}" was saved to your Journal, but the review screen couldn't open. Tap it in your Journal to add a rating or notes.`);
  }
}

// A plain alert() only ever runs this deep into an async chain (well past
// the original tap), and some browsers can silently swallow dialogs
// triggered that far removed from the user gesture that started it —
// worse than useless for a message whose whole point is "don't worry, it
// saved." A banner appended straight to <body> works no matter what state
// the modal system is in and can't be suppressed the same way.
function showFallbackNotice(message) {
  const notice = document.createElement('div');
  notice.className = 'notice warn fallback-notice';
  notice.textContent = message;
  notice.addEventListener('click', () => notice.remove());
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 8000);
}

el('manualAddBtn').addEventListener('click', () => openAddModal({}));

// ---------- Discover ----------

function skeletonCardHtml() {
  return `
    <div class="skeleton-card glass">
      <div class="skeleton-poster"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </div>`;
}

function journalSkeletonEntryHtml() {
  return `
    <div class="skeleton-entry glass">
      <div class="skeleton-poster"></div>
      <div class="skeleton-entry-body">
        <div class="skeleton-line title"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>`;
}

// Already-in-library results come first (reusing the same match check the
// badges use); beyond that, prefer sources' own popularity signal (TMDb
// `popularity`, RAWG `added`) as a rough tiebreaker where one exists.
function rankDiscoverResults(results) {
  return results
    .map((r, idx) => ({ r, idx }))
    .sort((a, b) => {
      const aMatch = findLibraryMatch(a.r) ? 1 : 0;
      const bMatch = findLibraryMatch(b.r) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      const aPop = a.r.popularity || 0;
      const bPop = b.r.popularity || 0;
      if (aPop !== bPop) return bPop - aPop;
      return a.idx - b.idx;
    })
    .map(({ r }) => r);
}

function updateDiscoverMergeNotice() {
  const notice = el('discoverMergeNotice');
  if (!notice) return;
  if (!discoverMergeTargetId) {
    notice.classList.add('hidden');
    notice.innerHTML = '';
    return;
  }
  const item = items.find((i) => i.id === discoverMergeTargetId);
  notice.innerHTML = `Pick a match to update <strong>${escapeHtml(item ? item.title : '')}</strong> — <button type="button" class="link-btn" id="discoverMergeCancelBtn">Cancel</button>`;
  notice.classList.remove('hidden');
  el('discoverMergeCancelBtn').addEventListener('click', () => {
    discoverMergeTargetId = null;
    updateDiscoverMergeNotice();
  });
}

// Entry point for the edit modal's "Update Info" button — jumps to Discover
// with the item's title searched across every type, since a quick-added
// item has no known type yet.
function startDiscoverMerge(item) {
  switchTab('discover');
  window.scrollTo(0, 0);
  discoverMergeTargetId = item.id;
  el('discoverQuery').value = item.title;
  el('discoverTypeChips').dataset.value = 'all';
  document.querySelectorAll('#discoverTypeChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.value === 'all'));
  updateDiscoverMergeNotice();
  runDiscoverSearch();
}

// Unlike Clean Up's gap-filling apply (which never overwrites existing
// data), picking a specific Discover result is an explicit "yes, this is
// it" choice — so it overwrites the item's identifying fields wholesale.
async function mergeDiscoverResultIntoItem(itemId, result) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return;
  const updated = await store.updateItem(itemId, {
    media_type: result.media_type,
    title: result.title || item.title,
    creator: result.creator || item.creator,
    year: result.year || item.year,
    poster_url: result.poster_url || item.poster_url,
    description: result.description || item.description,
    external_source: result.external_source || item.external_source,
    external_id: result.external_id || item.external_id,
    external_url: result.external_url || item.external_url,
    release_date: result.release_date || item.release_date,
  });
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx !== -1) items[idx] = updated;
  discoverMergeTargetId = null;
  updateDiscoverMergeNotice();
  renderJournal();
  renderBacklog();
  // Land back on whichever tab actually lists this item — Update Info can
  // now be started from a completed Journal entry too, not just Backlog.
  switchTab(updated.status === 'wishlist' ? 'backlog' : 'journal');
  openEditModal(updated);
}

async function runDiscoverSearch() {
  const query = el('discoverQuery').value.trim();
  if (!query) return;
  addRecentSearch(query);
  el('tab-discover').classList.remove('discover-empty');
  el('tab-discover').appendChild(el('manualAddBtn').closest('.manual-add-wrap'));
  const type = el('discoverTypeChips').dataset.value;
  el('discoverNotice').classList.add('hidden');
  el('discoverEmpty').classList.add('hidden');
  el('discoverResults').innerHTML = Array.from({ length: 8 }, skeletonCardHtml).join('');

  const notices = [];
  if (!tmdbAvailable() && (type === 'all' || type === 'movie' || type === 'tv')) {
    notices.push('Add a free TMDb API key to js/config.js to search movies & TV — see README.');
  }
  if (!rawgAvailable() && (type === 'all' || type === 'game')) {
    notices.push('Add a free RAWG API key to js/config.js to search video games — see README.');
  }

  const { results: rawResults, errors } = await searchExternal(query, type);
  const results = rankDiscoverResults(rawResults);
  errors.forEach((e) => notices.push(`${TYPE_LABEL[e.type] || e.type} search failed: ${e.message}`));

  if (notices.length) {
    el('discoverNotice').textContent = notices.join(' ');
    el('discoverNotice').classList.remove('hidden');
  }

  const hasExactMatch = results.some((r) => (r.title || '').trim().toLowerCase() === query.toLowerCase());
  const grid = el('discoverResults');
  grid.innerHTML = (hasExactMatch ? '' : manualAddCardHtml()) + results.map((r, idx) => discoverCardHtml(r, idx)).join('');
  el('discoverEmpty').classList.toggle('hidden', results.length > 0);
  grid.querySelectorAll('[data-idx]').forEach((node) => {
    node.addEventListener('click', () => {
      const result = results[parseInt(node.dataset.idx, 10)];
      if (discoverMergeTargetId) {
        mergeDiscoverResultIntoItem(discoverMergeTargetId, result);
        return;
      }
      // Already tracking this one — open its real modal (review summary,
      // backlog fields, or currently-watching progress, whichever applies)
      // instead of starting a new item.
      const match = findLibraryMatch(result);
      if (match) openEditModal(match);
      else openAddModal(result);
    });
  });
  const manualAddCard = grid.querySelector('[data-manual-add]');
  if (manualAddCard) manualAddCard.addEventListener('click', () => openAddModal({}));
}

el('discoverQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.target.blur();
    runDiscoverSearch();
  }
});
wireChipGroup('discoverTypeChips', () => {
  if (el('discoverQuery').value.trim()) runDiscoverSearch();
});
