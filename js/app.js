import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable, rawgAvailable, getTVSeasonInfo, SEARCHABLE_TYPES } from './search.js';
import { parseGoodreadsCsv, parseFableCsv, parseLetterboxdZip, dedupeAgainstLibrary, exportAsJson } from './importexport.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', album: '💿', game: '🎮', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', album: 'Album', game: 'Video Game', play: 'Play', restaurant: 'Restaurant', other: 'Other' };
const EXTERNAL_LINK_LABEL = { itunes: 'Open in Apple Podcasts', apple_music: 'Open in Apple Music', google_books: 'View on Google Books' };
const COMPLETED_VERB = { movie: 'Watched', tv: 'Watched', book: 'Read', podcast: 'Listened', album: 'Listened', game: 'Played', play: 'Seen', restaurant: 'Been', other: 'Done' };
const START_LABEL = { book: 'Start Reading', tv: 'Start Watching', game: 'Start Playing' };
const CURRENTLY_LABEL = { book: 'Currently Reading', tv: 'Currently Watching', game: 'Currently Playing' };

const PERCENT_PROGRESS_TYPES = ['book', 'game'];
const EPISODE_PROGRESS_TYPES = ['tv'];
const PROGRESS_TYPES = [...PERCENT_PROGRESS_TYPES, ...EPISODE_PROGRESS_TYPES];
const BACKLOG_TAGS = ['⭐ Shortlist', '👍 Recommended'];
const ALL_TYPES = ['movie', 'tv', 'book', 'podcast', 'album', 'game', 'play', 'restaurant', 'other'];
const QUICK_TAGS = { journal: ['❤️ Favorite'], backlog: ['⭐ Shortlist'] };

const store = createStore();
let items = [];
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
  if (store.mode === 'demo') {
    el('demoBanner').classList.remove('hidden');
    el('signOutBtn').classList.add('hidden');
  }

  store.onAuthChange(async (user) => {
    if (!user && store.mode === 'supabase') {
      location.replace('login.html');
      return;
    }
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
    const updated = await store.updateItem(item.id, { tags });
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx !== -1) items[idx] = updated;
  }
}

async function loadItems() {
  items = await store.listItems();
  await migrateFavoriteTag();
  renderBacklog();
  renderJournal();
}

el('signOutBtn').addEventListener('click', async () => {
  await store.signOut();
  location.replace('login.html');
});

el('accountBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  el('accountDropdown').classList.toggle('hidden');
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
    return `<img class="${sizeClass}" src="${escapeHtml(item.poster_url)}" alt="" loading="lazy">`;
  }
  return `<div class="${sizeClass}"></div>`;
}

function metaLine(item) {
  return [escapeHtml(item.creator), escapeHtml(item.year)].filter(Boolean).join(' · ');
}

function externalLinkHtml(item) {
  const label = EXTERNAL_LINK_LABEL[item.external_source];
  if (!label || !item.external_url) return '';
  return `<a href="${escapeHtml(item.external_url)}" target="_blank" rel="noopener noreferrer" class="external-link">${label}</a>`;
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
        if (t !== '⭐ Shortlist') used.add(t);
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
  return items.find(
    (i) =>
      (result.external_id && result.external_source && i.external_id === result.external_id && i.external_source === result.external_source) ||
      (i.media_type === result.media_type && i.title.trim().toLowerCase() === (result.title || '').trim().toLowerCase())
  );
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

const JOURNAL_SORTS = {
  completed_desc: { label: 'Date completed, newest first', cmp: (a, b) => effectiveCompletedDate(b) - effectiveCompletedDate(a) },
  completed_asc: { label: 'Date completed, oldest first', cmp: (a, b) => effectiveCompletedDate(a) - effectiveCompletedDate(b) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => (itemYear(b) || 0) - (itemYear(a) || 0) },
  rating_desc: { label: 'Ranking, highest first', cmp: (a, b) => (b.rating || 0) - (a.rating || 0) },
};

const BACKLOG_SORTS = {
  added_desc: { label: 'Date added, newest first', cmp: (a, b) => new Date(b.date_added) - new Date(a.date_added) },
  added_asc: { label: 'Date added, oldest first', cmp: (a, b) => new Date(a.date_added) - new Date(b.date_added) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => (itemYear(b) || 0) - (itemYear(a) || 0) },
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
      const updated = await store.updateItem(id, { progress_percent: clampPct(parseInt(slider.value, 10) || 0) });
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
  el('modalRoot').innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-sheet glass-strong">${innerHtml}</div>
    </div>`;
  el('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
}

// ---------- Clean up Journal / Backlog ----------
// Finds completed items missing a poster or a watched date, or backlog
// items missing a poster — almost every item imported from Goodreads/
// Fable/Letterboxd, since those exports never include a poster/description
// and often omit a per-item finish date — and offers a one-click
// auto-matched fix per item, without ever overwriting data that's already
// there.

// Journal items can be missing a poster or a watched date; Backlog items
// have no watched date to speak of, so only a missing poster counts there.
const CLEANUP_LABELS = {
  completed: { title: 'Clean up Journal', gap: 'a poster or watched date', gapDone: 'a poster and a watched date' },
  wishlist: { title: 'Clean up Backlog', gap: 'a poster', gapDone: 'a poster' },
};

function cleanupCandidates(status) {
  return items.filter((i) => i.status === status && (!i.poster_url || (status === 'completed' && !i.date_completed)));
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

function cleanupMatchSuggestionHtml(match) {
  return `
    <div class="cleanup-match-suggestion">
      ${posterOrEmoji(match, 'cleanup-match-poster')}
      <div class="cleanup-match-info">
        <p class="cleanup-match-title">${escapeHtml(match.title)}${match.year ? ` <span class="cleanup-row-year">(${escapeHtml(match.year)})</span>` : ''}</p>
        <div class="cleanup-match-actions">
          <button type="button" class="btn-primary btn-small" data-apply-match>Use this poster</button>
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
function maybeRemoveResolvedRow(item) {
  const row = document.querySelector(`.cleanup-row[data-item-id="${item.id}"]`);
  if (row && !row.querySelector('.cleanup-date-field') && !row.querySelector('[data-match-slot]')) {
    row.remove();
  }
  const list = el('cleanupList');
  const remaining = list.children.length;
  const gap = list.dataset.cleanupGap;
  el('cleanupSubtitle').textContent = remaining ? `${remaining} item${remaining === 1 ? '' : 's'} missing ${gap}.` : 'All caught up!';
  if (!remaining) {
    list.classList.add('hidden');
    el('cleanupAllDone').classList.remove('hidden');
  }
}

// Keeps the bulk "use all suggested posters" button's count/disabled state
// in sync with however many rows currently have a match ready to apply.
function updateCleanupApplyAllBtn() {
  const btn = el('cleanupApplyAllBtn');
  if (!btn) return;
  const count = document.querySelectorAll('.cleanup-row [data-apply-match]').length;
  btn.textContent = count ? `Use all suggested posters (${count})` : 'Use all suggested posters';
  btn.disabled = count === 0;
}

function wireCleanupMatchActions(slot, item, match) {
  slot.querySelector('[data-apply-match]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    const updated = await applyCleanupMatch(item, match);
    item = updated;
    const row = document.querySelector(`.cleanup-row[data-item-id="${item.id}"]`);
    if (row) row.querySelector('.cleanup-poster').outerHTML = posterOrEmoji(item, 'cleanup-poster');
    if (updated.poster_url) {
      slot.remove();
    } else {
      slot.innerHTML = `<p class="cleanup-no-match">That match didn't include a poster — <button type="button" class="link-btn" data-open-edit>edit manually</button>.</p>`;
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
  let match = null;
  try {
    const { results } = await searchExternal(item.title, item.media_type);
    match = bestCleanupMatch(item, results);
  } catch {
    match = null;
  }
  if (!document.body.contains(slot)) return; // row was removed/resolved while the search was in flight
  if (match) {
    slot.innerHTML = cleanupMatchSuggestionHtml(match);
    wireCleanupMatchActions(slot, item, match);
  } else {
    slot.innerHTML = cleanupNoMatchHtml();
    wireCleanupNoMatch(slot, item);
  }
  updateCleanupApplyAllBtn();
}

function cleanupRowHtml(item) {
  const needsPoster = !item.poster_url;
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
                <input type="date" data-cleanup-date>
              </div>`
            : ''
        }
        ${
          needsPoster
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

function openCleanupModal(status) {
  const labels = CLEANUP_LABELS[status];
  const candidates = cleanupCandidates(status);
  const html = `
    <div class="modal-header">
      <div style="flex:1">
        <p class="modal-title">${labels.title}</p>
        <p class="modal-subtitle" id="cleanupSubtitle">${candidates.length} item${candidates.length === 1 ? '' : 's'} missing ${labels.gap}.</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${candidates.length ? `<button type="button" class="btn-secondary" id="cleanupApplyAllBtn" style="width:100%;margin-bottom:14px;" disabled>Use all suggested posters</button>` : ''}
    <div id="cleanupList" class="cleanup-list${candidates.length ? '' : ' hidden'}" data-cleanup-gap="${escapeHtml(labels.gap)}">${candidates.map(cleanupRowHtml).join('')}</div>
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

  const searchable = candidates.filter((i) => !i.poster_url && SEARCHABLE_TYPES.includes(i.media_type));
  runWithConcurrency(searchable, 3, loadCleanupMatch);
}

// ---------- Import / Export ----------

function openImportExportModal() {
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
        <p class="modal-subtitle">${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${current.year ? ' · ' + escapeHtml(current.year) : ''}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(current)}
    ${descriptionHtml(current.description, 'editDescription')}
    ${
      current.status === 'wishlist' && !current.poster_url
        ? `<button type="button" class="btn-secondary" id="updateInfoBtn" style="width:100%;margin-bottom:12px;">Update Info</button>`
        : ''
    }
    ${
      current.status === 'wishlist'
        ? `<div class="field" id="backlogTagField"><label>Tags</label>${tagChipsHtml('editBacklogTagChips', BACKLOG_TAGS, current.tags || [])}</div>`
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
      persist({ progress_percent: clampPct(parseInt(e.target.value, 10) || 0) });
    });

    number.addEventListener('input', (e) => {
      slider.value = clampPct(parseInt(e.target.value, 10) || 0);
    });
    number.addEventListener('change', (e) => {
      const v = clampPct(parseInt(e.target.value, 10) || 0);
      number.value = v;
      slider.value = v;
      persist({ progress_percent: v });
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
        };
      };
      updateEpisodeOptions();

      seasonSelect.addEventListener('change', (e) => {
        persist({ progress_season: parseInt(e.target.value, 10) || 1 });
        updateEpisodeOptions();
      });
    });
  }

  const startBtn = el('startProgressBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const patch = PERCENT_PROGRESS_TYPES.includes(current.media_type)
        ? { status: 'in_progress', progress_percent: 0 }
        : { status: 'in_progress', progress_season: 1, progress_episode: 1 };
      await persist(patch);
      closeModal();
      document.querySelector('.tab[data-tab="journal"]').click();
    });
  }

  if (current.status === 'wishlist') {
    wireTagChips('editBacklogTagChips', () => {
      persist({ tags: getActiveChipValues('editBacklogTagChips') });
    });
  }

  const markBtn = el('markWatchedBtn');
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      const updated = await persist({
        status: 'completed',
        date_completed: current.date_completed || new Date().toISOString(),
        tags: (current.tags || []).filter((t) => !BACKLOG_TAGS.includes(t)),
      });
      document.querySelector('.tab[data-tab="journal"]').click();
      openReviewModal(updated);
    });
  }

  const editReviewBtn = el('editReviewBtn');
  if (editReviewBtn) {
    editReviewBtn.addEventListener('click', () => openReviewModal(current));
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

function dateInputValue(iso) {
  return iso ? iso.slice(0, 10) : '';
}

function dateInputToIso(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

function openReviewModal(item) {
  let current = item;

  const html = `
    <div class="modal-header">
      ${posterOrEmoji(current, 'modal-poster')}
      <div style="flex:1">
        <p class="modal-title">${escapeHtml(current.title)}</p>
        <p class="modal-subtitle">${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${current.year ? ' · ' + escapeHtml(current.year) : ''}</p>
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
      <input type="date" id="reviewDateCompleted" value="${dateInputValue(current.date_completed)}">
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
    document.querySelector('.tab[data-tab="journal"]').click();
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
    <div class="modal-actions stack">
      <button type="button" class="btn-secondary" id="addBacklogBtn">+ Add to Backlog</button>
      <button type="button" class="btn-secondary hidden" id="addCurrentlyBtn">Currently Reading</button>
      <button type="button" class="btn-primary" id="addWatchedBtn">✓ Mark as Watched</button>
    </div>
  `;
  openModalWithContent(html);
  wireDescriptionToggle('addDescription');
  el('modalCloseBtn').addEventListener('click', closeModal);

  function currentDraft() {
    return {
      media_type: el('addType').value,
      title: el('addTitle').value.trim(),
      creator: el('addCreator').value.trim() || null,
      year: el('addYear').value.trim() || null,
      poster_url: prefill.poster_url || null,
      description: prefill.description || null,
      external_source: prefill.external_source || 'manual',
      external_id: prefill.external_id || null,
      external_url: prefill.external_url || null,
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
    const saved = await store.addItem({ ...draft, status: 'wishlist' });
    items.unshift(saved);
    renderBacklog();
    renderJournal();
    closeModal();
    document.querySelector('.tab[data-tab="backlog"]').click();
  });

  el('addCurrentlyBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    const progress = PERCENT_PROGRESS_TYPES.includes(draft.media_type) ? { progress_percent: 0 } : { progress_season: 1, progress_episode: 1 };
    const saved = await store.addItem({ ...draft, status: 'in_progress', ...progress });
    items.unshift(saved);
    renderBacklog();
    renderJournal();
    closeModal();
    document.querySelector('.tab[data-tab="journal"]').click();
  });

  el('addWatchedBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    const saved = await store.addItem({
      ...draft,
      status: 'completed',
      rating: null,
      tags: [],
      notes: null,
      date_completed: new Date().toISOString(),
    });
    items.unshift(saved);
    renderBacklog();
    renderJournal();
    document.querySelector('.tab[data-tab="journal"]').click();
    openReviewModal(saved);
  });
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
  });
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx !== -1) items[idx] = updated;
  discoverMergeTargetId = null;
  updateDiscoverMergeNotice();
  renderJournal();
  renderBacklog();
  switchTab('backlog');
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
