import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable, rawgAvailable, getTVSeasonInfo } from './search.js';
import { parseGoodreadsCsv, parseFableCsv, parseLetterboxdZip, dedupeAgainstLibrary, exportAsJson } from './importexport.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', game: '🎮', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', game: 'Video Game', play: 'Play', restaurant: 'Restaurant', other: 'Other' };
const EXTERNAL_LINK_LABEL = { itunes: '🎧 Open in Apple Podcasts', google_books: '📖 View on Google Books' };
const COMPLETED_VERB = { movie: 'Watched', tv: 'Watched', book: 'Read', podcast: 'Listened', game: 'Played', play: 'Seen', restaurant: 'Been', other: 'Done' };
const START_LABEL = { book: '📖 Start Reading', tv: '📺 Start Watching', game: '🎮 Start Playing' };
const CURRENTLY_LABEL = { book: '📖 Currently Reading', tv: '📺 Currently Watching', game: '🎮 Currently Playing' };

const PERCENT_PROGRESS_TYPES = ['book', 'game'];
const EPISODE_PROGRESS_TYPES = ['tv'];
const PROGRESS_TYPES = [...PERCENT_PROGRESS_TYPES, ...EPISODE_PROGRESS_TYPES];
const WISHLIST_TAGS = ['⭐ Shortlist', '👍 Recommended'];
const ALL_TYPES = ['movie', 'tv', 'book', 'podcast', 'game', 'play', 'restaurant', 'other'];
const QUICK_TAGS = { journal: ['❤️ Favorite'], wishlist: ['⭐ Shortlist'] };

const store = createStore();
let items = [];
let wishlistSelectedTags = new Set();
let journalSelectedTags = new Set();
let journalSelectedRatings = new Set();
let wishlistSelectedTypes = new Set();
let journalSelectedTypes = new Set();
let journalSortKey = 'completed_desc';
let wishlistSortKey = 'added_desc';

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
  renderWishlist();
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
  if (tabName === 'journal' || tabName === 'wishlist') {
    el('discoverQuery').value = '';
    el('headerSearchInput').value = '';
  }
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
// On desktop, the Journal/Wishlist pills live in the header next to the
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
}

applyResponsiveNav(desktopNavQuery.matches);
desktopNavQuery.addEventListener('change', (e) => applyResponsiveNav(e.matches));

// ---------- Rendering helpers ----------

function posterOrEmoji(item, sizeClass = 'card-poster') {
  if (item.poster_url) {
    return `<img class="${sizeClass}" src="${escapeHtml(item.poster_url)}" alt="" loading="lazy">`;
  }
  return `<div class="${sizeClass}">${TYPE_EMOJI[item.media_type] || '✨'}</div>`;
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

function tagPillsHtml(item) {
  if (!item.tags || !item.tags.length) return '';
  return `<div class="item-tags">${item.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`;
}

function tagChipsHtml(id, options, selected) {
  return `<div class="chip-row" id="${id}">${options
    .map((t) => `<button type="button" class="chip${selected.includes(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
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
        ${pool.map((t) => `<button type="button" class="chip${selected.includes(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
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
      <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
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
        <p class="journal-entry-meta">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}</p>
        <div class="card-stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
        ${tagPillsHtml(item)}
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

function discoverCardHtml(item, idx) {
  const match = findLibraryMatch(item);
  return `
    <div class="card glass${match && match.status === 'completed' ? ' card--seen' : ''}" data-idx="${idx}">
      <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
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

const JOURNAL_SORTS = {
  completed_desc: { label: 'Date completed, newest first', cmp: (a, b) => new Date(b.date_completed || b.updated_at || 0) - new Date(a.date_completed || a.updated_at || 0) },
  completed_asc: { label: 'Date completed, oldest first', cmp: (a, b) => new Date(a.date_completed || a.updated_at || 0) - new Date(b.date_completed || b.updated_at || 0) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => (itemYear(b) || 0) - (itemYear(a) || 0) },
  rating_desc: { label: 'Ranking, highest first', cmp: (a, b) => (b.rating || 0) - (a.rating || 0) },
};

const WISHLIST_SORTS = {
  added_desc: { label: 'Date added, newest first', cmp: (a, b) => new Date(b.date_added) - new Date(a.date_added) },
  added_asc: { label: 'Date added, oldest first', cmp: (a, b) => new Date(a.date_added) - new Date(b.date_added) },
  release_desc: { label: 'Release date, newest first', cmp: (a, b) => (itemYear(b) || 0) - (itemYear(a) || 0) },
};

function renderWishlist() {
  const list = items
    .filter((i) => i.status === 'wishlist')
    .filter((i) => typeMatches(i, wishlistSelectedTypes))
    .filter((i) => wishlistSelectedTags.size === 0 || (i.tags || []).some((t) => wishlistSelectedTags.has(t)))
    .sort(WISHLIST_SORTS[wishlistSortKey].cmp);
  const grid = el('wishlistGrid');
  grid.innerHTML = list.map(cardHtml).join('');
  el('wishlistEmpty').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
}

function currentlyEntryHtml(item) {
  if (PERCENT_PROGRESS_TYPES.includes(item.media_type)) {
    const pct = item.progress_percent || 0;
    return `
      <div class="currently-card glass" data-item-id="${item.id}">
        <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
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
      <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
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

function renderJournal() {
  const list = items
    .filter((i) => i.status === 'completed' && typeMatches(i, journalSelectedTypes))
    .filter((i) => journalSelectedTags.size === 0 || (i.tags || []).some((t) => journalSelectedTags.has(t)))
    .filter((i) => journalSelectedRatings.size === 0 || journalSelectedRatings.has(i.rating))
    .sort(JOURNAL_SORTS[journalSortKey].cmp);
  const feed = el('journalFeed');
  feed.innerHTML = list.map(journalEntryHtml).join('');
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
    const selectedTypes = kind === 'journal' ? journalSelectedTypes : wishlistSelectedTypes;
    selectedTypes.clear();
    getActiveChipValues(id).forEach((v) => selectedTypes.add(v));
    syncFilterUI(kind);
    if (kind === 'journal') renderJournal();
    else renderWishlist();
  });
}

function sortOptionsHtml(name, sorts, currentKey) {
  return Object.entries(sorts)
    .map(([key, { label }]) => `<label class="tag-filter-option"><input type="radio" name="${name}" value="${key}" ${key === currentKey ? 'checked' : ''}> ${escapeHtml(label)}</label>`)
    .join('');
}

function renderQuickTags(kind) {
  const selected = kind === 'journal' ? journalSelectedTags : wishlistSelectedTags;
  const container = el(`${kind}QuickTags`);
  container.innerHTML = QUICK_TAGS[kind]
    .map((t) => `<button type="button" class="chip${selected.has(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join('');
  container.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => toggleQuickTag(kind, chip.dataset.value));
  });
}

function toggleQuickTag(kind, tag) {
  const selected = kind === 'journal' ? journalSelectedTags : wishlistSelectedTags;
  if (selected.has(tag)) selected.delete(tag);
  else selected.add(tag);
  syncFilterUI(kind);
  if (kind === 'journal') renderJournal();
  else renderWishlist();
}

// Keeps the quick chips, the Filter button's "active" dot, and (if open)
// the dropdown's own checkboxes/chips all reflecting the same state,
// regardless of which surface the last change came from.
function syncFilterUI(kind) {
  const selectedTags = kind === 'journal' ? journalSelectedTags : wishlistSelectedTags;
  const selectedTypes = kind === 'journal' ? journalSelectedTypes : wishlistSelectedTypes;
  const selectedRatings = kind === 'journal' ? journalSelectedRatings : null;

  el(`${kind}QuickTags`).querySelectorAll('.chip').forEach((chip) => {
    chip.classList.toggle('active', selectedTags.has(chip.dataset.value));
  });

  const anyActive = selectedTypes.size > 0 || selectedTags.size > 0 || (selectedRatings && selectedRatings.size > 0);
  el(`${kind}FilterBtn`).classList.toggle('active', anyActive);

  const dropdown = el(`${kind}FilterDropdown`);
  if (!dropdown.classList.contains('hidden')) {
    dropdown.querySelectorAll('.chip[data-value]').forEach((chip) => {
      if (ALL_TYPES.includes(chip.dataset.value)) chip.classList.toggle('active', selectedTypes.has(chip.dataset.value));
    });
    dropdown.querySelectorAll('input[data-filter-tag]').forEach((cb) => {
      cb.checked = selectedTags.has(cb.value);
    });
  }
}

function renderWishlistFilterDropdown() {
  const dropdown = el('wishlistFilterDropdown');
  dropdown.innerHTML = `
    <div class="tag-filter-section-heading">Categories</div>
    ${typeChipsHtml('wishlistFilterTypeChips', wishlistSelectedTypes)}
    <div class="tag-filter-section-heading">Tags</div>
    ${WISHLIST_TAGS.map((t) => `<label class="tag-filter-option"><input type="checkbox" data-filter-tag value="${escapeHtml(t)}" ${wishlistSelectedTags.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`).join('')}
    <div class="tag-filter-section-heading">Sort by</div>
    ${sortOptionsHtml('wishlistSort', WISHLIST_SORTS, wishlistSortKey)}
    <button type="button" class="tag-filter-reset" id="wishlistFilterReset">Reset filters</button>
  `;

  wireTypeChips('wishlistFilterTypeChips', 'wishlist');

  dropdown.querySelectorAll('input[data-filter-tag]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) wishlistSelectedTags.add(cb.value);
      else wishlistSelectedTags.delete(cb.value);
      syncFilterUI('wishlist');
      renderWishlist();
    });
  });

  dropdown.querySelectorAll('input[name="wishlistSort"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      wishlistSortKey = radio.value;
      renderWishlist();
    });
  });

  el('wishlistFilterReset').addEventListener('click', (e) => {
    e.stopPropagation();
    wishlistSelectedTypes.clear();
    wishlistSelectedTags.clear();
    renderWishlistFilterDropdown();
    syncFilterUI('wishlist');
    renderWishlist();
  });
}

el('wishlistFilterBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  renderWishlistFilterDropdown();
  el('wishlistFilterDropdown').classList.toggle('hidden');
});

function renderJournalFilterDropdown() {
  const allTags = Array.from(new Set(items.filter((i) => i.status === 'completed').flatMap((i) => i.tags || []))).sort();
  const dropdown = el('journalFilterDropdown');

  const tagsHtml = allTags.length
    ? allTags
        .map(
          (t) =>
            `<label class="tag-filter-option"><input type="checkbox" data-filter-tag value="${escapeHtml(t)}" ${journalSelectedTags.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`
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
});

renderQuickTags('journal');
renderQuickTags('wishlist');

document.addEventListener('click', (e) => {
  document.querySelectorAll('.tag-filter-dropdown').forEach((dropdown) => {
    if (!dropdown.classList.contains('hidden') && !e.target.closest('.tag-filter-wrap')) {
      dropdown.classList.add('hidden');
    }
  });
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
      <button type="button" class="btn-secondary" id="exportJsonBtn" style="width:100%;">⬇️ Export my data (JSON)</button>
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
      renderWishlist();
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
        <p class="modal-subtitle">${TYPE_EMOJI[current.media_type]} ${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${current.year ? ' · ' + escapeHtml(current.year) : ''}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(current)}
    ${descriptionHtml(current.description, 'editDescription')}
    ${
      current.status === 'wishlist'
        ? `<div class="field" id="wishlistTagField"><label>Tags</label>${tagChipsHtml('editWishlistTagChips', WISHLIST_TAGS, current.tags || [])}</div>`
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
            <button type="button" class="btn-ghost" id="unmarkBtn" style="width:100%;margin-top:4px;">${hasProgress(current) ? '↩ Move back to Currently Reading/Watching' : '↩ Move back to Wishlist'}</button>
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

  async function persist(patch) {
    const updated = await store.updateItem(current.id, patch);
    current = updated;
    const idx = items.findIndex((i) => i.id === current.id);
    if (idx !== -1) items[idx] = updated;
    renderWishlist();
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
    wireTagChips('editWishlistTagChips', () => {
      persist({ tags: getActiveChipValues('editWishlistTagChips') });
    });
  }

  const markBtn = el('markWatchedBtn');
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      const updated = await persist({
        status: 'completed',
        date_completed: current.date_completed || new Date().toISOString(),
        tags: (current.tags || []).filter((t) => !WISHLIST_TAGS.includes(t)),
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
    if (!confirm(`Remove "${current.title}" from your ${current.status === 'wishlist' ? 'wishlist' : 'journal'}?`)) return;
    await store.deleteItem(current.id);
    items = items.filter((i) => i.id !== current.id);
    renderWishlist();
    renderJournal();
    closeModal();
  });
}

function openReviewModal(item) {
  let current = item;

  const html = `
    <div class="modal-header">
      ${posterOrEmoji(current, 'modal-poster')}
      <div style="flex:1">
        <p class="modal-title">${escapeHtml(current.title)}</p>
        <p class="modal-subtitle">${TYPE_EMOJI[current.media_type]} ${TYPE_LABEL[current.media_type]}${current.creator ? ' · ' + escapeHtml(current.creator) : ''}${current.year ? ' · ' + escapeHtml(current.year) : ''}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(current)}
    <div class="field">
      <label>Your rating</label>
      ${starsEditableHtml('reviewStars', current.rating)}
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
    renderWishlist();
    renderJournal();
  }

  wireStars('reviewStars', (rating) => {
    persist({ rating: rating || null });
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
    : `<div class="modal-poster" style="display:flex;align-items:center;justify-content:center;font-size:32px;background:rgba(120,120,128,0.12)">${TYPE_EMOJI[prefill.media_type] || '✨'}</div>`;

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
        ${Object.keys(TYPE_LABEL).map((t) => `<option value="${t}" ${t === prefill.media_type ? 'selected' : ''}>${TYPE_EMOJI[t]} ${TYPE_LABEL[t]}</option>`).join('')}
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
      <button type="button" class="btn-primary" id="addWishlistBtn">+ Add to Wishlist</button>
      <button type="button" class="btn-secondary hidden" id="addCurrentlyBtn">▶ Currently Reading</button>
      <button type="button" class="btn-secondary" id="addWatchedBtn">✓ Mark as Watched</button>
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

  el('addWishlistBtn').addEventListener('click', async () => {
    const draft = currentDraft();
    if (!draft.title) {
      el('addTitle').focus();
      return;
    }
    const saved = await store.addItem({ ...draft, status: 'wishlist' });
    items.unshift(saved);
    renderWishlist();
    renderJournal();
    closeModal();
    document.querySelector('.tab[data-tab="wishlist"]').click();
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
    renderWishlist();
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
    renderWishlist();
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

async function runDiscoverSearch() {
  const query = el('discoverQuery').value.trim();
  if (!query) return;
  addRecentSearch(query);
  el('tab-discover').classList.remove('discover-empty');
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

  const grid = el('discoverResults');
  grid.innerHTML = results.map((r, idx) => discoverCardHtml(r, idx)).join('');
  el('discoverEmpty').classList.toggle('hidden', results.length > 0);
  grid.querySelectorAll('[data-idx]').forEach((node) => {
    node.addEventListener('click', () => openAddModal(results[parseInt(node.dataset.idx, 10)]));
  });
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
