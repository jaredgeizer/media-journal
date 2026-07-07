import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable } from './search.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', play: 'Play', restaurant: 'Restaurant', other: 'Other' };
const EXTERNAL_LINK_LABEL = { itunes: '🎧 Open in Apple Podcasts', google_books: '📖 View on Google Books' };
const COMPLETED_VERB = { movie: 'Watched', tv: 'Watched', book: 'Read', podcast: 'Listened', play: 'Seen', restaurant: 'Been', other: 'Done' };

const PROGRESS_TYPES = ['book', 'tv'];
const WISHLIST_TAGS = ['⭐ Shortlist'];
const REACTION_TAGS = {
  movie: ['Favorite', 'Would Rewatch', 'Recommend', 'Meh', 'Disappointing'],
  tv: ['Favorite', 'Would Rewatch', 'Recommend', 'Meh', 'Disappointing'],
  book: ['Favorite', 'Would Reread', 'Recommend', 'Meh', 'Disappointing'],
  podcast: ['Favorite', 'Would Relisten', 'Recommend', 'Meh', 'Disappointing'],
  play: ['Favorite', 'Would See Again', 'Recommend', 'Meh', 'Disappointing'],
  restaurant: ['Favorite', 'Would Return', 'Recommend', 'Meh', 'Disappointing'],
  other: ['Favorite', 'Recommend', 'Meh', 'Disappointing'],
};

const store = createStore();
let items = [];
let wishlistShortlistOnly = false;
let journalSelectedTags = new Set();

const el = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Boot ----------

async function boot() {
  await store.init();

  if (store.mode === 'demo') {
    el('demoBanner').classList.remove('hidden');
  } else {
    el('signOutBtn').classList.remove('hidden');
  }

  store.onAuthChange(async (user) => {
    if (!user && store.mode === 'supabase') {
      location.replace('login.html');
      return;
    }
    await loadItems();
  });
}

async function loadItems() {
  items = await store.listItems();
  renderWishlist();
  renderJournal();
}

el('signOutBtn').addEventListener('click', async () => {
  await store.signOut();
  location.replace('login.html');
});

boot();

// ---------- Tabs ----------

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    el('tab-' + btn.dataset.tab).classList.add('active');
  });
});

el('discoverFabBtn').addEventListener('click', () => {
  el('discoverQuery').focus();
});

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

function tagPillsHtml(item) {
  if (!item.tags || !item.tags.length) return '';
  return `<div class="item-tags">${item.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`;
}

function tagChipsHtml(id, options, selected) {
  return `<div class="chip-row" id="${id}">${options
    .map((t) => `<button type="button" class="chip${selected.includes(t) ? ' active' : ''}" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join('')}</div>`;
}

function wireTagChips(id) {
  el(id).querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });
}

function getActiveChipValues(id) {
  return Array.from(el(id).querySelectorAll('.chip.active')).map((c) => c.dataset.value);
}

function hasProgress(item) {
  if (item.media_type === 'book') return item.progress_percent != null;
  if (item.media_type === 'tv') return item.progress_season != null || item.progress_episode != null;
  return false;
}

function progressFieldHtml(item) {
  if (item.status !== 'in_progress') return '';
  if (item.media_type === 'book') {
    const pct = item.progress_percent || 0;
    return `
      <div class="field">
        <label>Progress</label>
        <div class="progress-row">
          <input type="range" id="editProgressPercent" min="0" max="100" step="1" value="${pct}">
          <span id="editProgressPercentLabel">${pct}%</span>
        </div>
      </div>`;
  }
  if (item.media_type === 'tv') {
    const season = item.progress_season || 1;
    const episode = item.progress_episode || 1;
    return `
      <div class="field">
        <label>Progress</label>
        <div class="progress-row">
          <span class="progress-subtext">Season</span>
          <input type="number" id="editProgressSeason" min="1" value="${season}">
          <span class="progress-subtext">Episode</span>
          <input type="number" id="editProgressEpisode" min="1" value="${episode}">
        </div>
      </div>`;
  }
  return '';
}

function ratingHintText(item) {
  if (item.status === 'wishlist') return 'Rate it to move it to your journal.';
  if (item.status === 'in_progress') return 'Rate it to finish and move it to your journal.';
  return hasProgress(item)
    ? 'Clear the rating to go back to Currently Reading/Watching.'
    : 'Clear the rating to move this back to your wishlist.';
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

function getFilters(prefix) {
  return {
    text: el(prefix + 'Filter').value.trim().toLowerCase(),
    type: el(prefix + 'TypeChips').dataset.value,
  };
}

function matches(item, { text, type }) {
  if (type !== 'all' && item.media_type !== type) return false;
  if (!text) return true;
  const hay = [item.title, item.creator, item.notes, ...(item.tags || [])].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(text);
}

function renderWishlist() {
  const filters = getFilters('wishlist');
  const list = items
    .filter((i) => i.status === 'wishlist' && matches(i, filters))
    .filter((i) => !wishlistShortlistOnly || (i.tags || []).includes('⭐ Shortlist'))
    .sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  const grid = el('wishlistGrid');
  grid.innerHTML = list.map(cardHtml).join('');
  el('wishlistEmpty').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
}

function currentlyEntryHtml(item) {
  const progressText =
    item.media_type === 'book'
      ? `${item.progress_percent || 0}% done`
      : `Season ${item.progress_season || 1}, Episode ${item.progress_episode || 1}`;
  return `
    <div class="journal-entry glass" data-item-id="${item.id}">
      ${posterOrEmoji(item)}
      <div class="journal-entry-body">
        <div class="journal-entry-header">
          <p class="journal-entry-title">${escapeHtml(item.title)}</p>
        </div>
        <p class="journal-entry-meta">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}</p>
        <p class="progress-badge">${progressText}</p>
      </div>
    </div>`;
}

function renderCurrently() {
  const filters = getFilters('journal');
  const list = items
    .filter((i) => i.status === 'in_progress' && matches(i, filters))
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  const container = el('currentlyContainer');
  const feed = el('currentlyFeed');
  feed.innerHTML = list.map(currentlyEntryHtml).join('');
  container.classList.toggle('hidden', list.length === 0);
  feed.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
}

function renderJournal() {
  const filters = getFilters('journal');
  const list = items
    .filter((i) => i.status === 'completed' && matches(i, filters))
    .filter((i) => journalSelectedTags.size === 0 || (i.tags || []).some((t) => journalSelectedTags.has(t)))
    .sort((a, b) => new Date(b.date_completed || b.updated_at || 0) - new Date(a.date_completed || a.updated_at || 0));
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

el('wishlistFilter').addEventListener('input', renderWishlist);
wireChipGroup('wishlistTypeChips', renderWishlist);
el('journalFilter').addEventListener('input', renderJournal);
wireChipGroup('journalTypeChips', renderJournal);

el('wishlistShortlistFilterBtn').addEventListener('click', () => {
  wishlistShortlistOnly = !wishlistShortlistOnly;
  el('wishlistShortlistFilterBtn').classList.toggle('active', wishlistShortlistOnly);
  renderWishlist();
});

function renderJournalTagDropdown() {
  const allTags = Array.from(new Set(items.filter((i) => i.status === 'completed').flatMap((i) => i.tags || []))).sort();
  const dropdown = el('journalTagFilterDropdown');
  if (!allTags.length) {
    dropdown.innerHTML = `<p class="tag-filter-empty">No tags yet.</p>`;
    return;
  }
  dropdown.innerHTML = allTags
    .map(
      (t) =>
        `<label class="tag-filter-option"><input type="checkbox" value="${escapeHtml(t)}" ${journalSelectedTags.has(t) ? 'checked' : ''}> ${escapeHtml(t)}</label>`
    )
    .join('');
  dropdown.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) journalSelectedTags.add(cb.value);
      else journalSelectedTags.delete(cb.value);
      el('journalTagFilterBtn').classList.toggle('active', journalSelectedTags.size > 0);
      renderJournal();
    });
  });
}

el('journalTagFilterBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  renderJournalTagDropdown();
  el('journalTagFilterDropdown').classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  const dropdown = el('journalTagFilterDropdown');
  if (!dropdown.classList.contains('hidden') && !e.target.closest('.tag-filter-wrap')) {
    dropdown.classList.add('hidden');
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

function getStarsValue(id) {
  return parseInt(el(id).dataset.rating, 10) || 0;
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

function openEditModal(item) {
  const html = `
    <div class="modal-header">
      ${posterOrEmoji(item, 'modal-poster')}
      <div style="flex:1">
        <p class="modal-title">${escapeHtml(item.title)}</p>
        <p class="modal-subtitle">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}${item.creator ? ' · ' + escapeHtml(item.creator) : ''}${item.year ? ' · ' + escapeHtml(item.year) : ''}</p>
      </div>
      <button class="modal-close" id="modalCloseBtn">✕</button>
    </div>
    ${externalLinkHtml(item)}
    ${item.description ? `<p class="journal-entry-notes" style="-webkit-line-clamp:unset;margin-bottom:16px;color:var(--text-secondary)">${escapeHtml(item.description)}</p>` : ''}
    ${
      item.status === 'wishlist' && PROGRESS_TYPES.includes(item.media_type)
        ? `<button type="button" class="btn-secondary" id="startProgressBtn" style="width:100%;margin-bottom:16px;">${item.media_type === 'book' ? '📖 Start Reading' : '📺 Start Watching'}</button>`
        : ''
    }
    ${progressFieldHtml(item)}
    <div class="field">
      <label>Your rating</label>
      ${starsEditableHtml('editStars', item.rating)}
      <p style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">${ratingHintText(item)}</p>
    </div>
    <div class="field${item.rating > 0 || item.status !== 'wishlist' ? ' hidden' : ''}" id="wishlistTagField">
      <label>Tags</label>
      ${tagChipsHtml('editWishlistTagChips', WISHLIST_TAGS, item.tags || [])}
    </div>
    <div class="field${item.rating > 0 ? '' : ' hidden'}" id="reactionTagField">
      <label>Tags</label>
      ${tagChipsHtml('editReactionTagChips', REACTION_TAGS[item.media_type] || REACTION_TAGS.other, item.tags || [])}
    </div>
    <div class="field">
      <label for="editNotes">Notes</label>
      <textarea id="editNotes" placeholder="Thoughts, quotes, where you left off…">${escapeHtml(item.notes || '')}</textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-danger" id="deleteBtn">Remove</button>
      <button class="btn-primary" id="saveBtn">Save</button>
    </div>
  `;
  openModalWithContent(html);
  wireTagChips('editWishlistTagChips');
  wireTagChips('editReactionTagChips');
  wireStars('editStars', (rating) => {
    el('wishlistTagField').classList.toggle('hidden', !(rating === 0 && item.status === 'wishlist'));
    el('reactionTagField').classList.toggle('hidden', rating === 0);
  });
  el('modalCloseBtn').addEventListener('click', closeModal);

  if (item.status === 'in_progress' && item.media_type === 'book') {
    el('editProgressPercent').addEventListener('input', (e) => {
      el('editProgressPercentLabel').textContent = e.target.value + '%';
    });
  }

  const startBtn = el('startProgressBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const patch =
        item.media_type === 'book'
          ? { status: 'in_progress', progress_percent: 0 }
          : { status: 'in_progress', progress_season: 1, progress_episode: 1 };
      const updated = await store.updateItem(item.id, patch);
      const idx = items.findIndex((i) => i.id === item.id);
      items[idx] = updated;
      renderWishlist();
      renderJournal();
      closeModal();
    });
  }

  el('deleteBtn').addEventListener('click', async () => {
    if (!confirm(`Remove "${item.title}" from your ${item.status === 'wishlist' ? 'wishlist' : 'journal'}?`)) return;
    await store.deleteItem(item.id);
    items = items.filter((i) => i.id !== item.id);
    renderWishlist();
    renderJournal();
    closeModal();
  });

  el('saveBtn').addEventListener('click', async () => {
    const rating = getStarsValue('editStars');
    const status = rating > 0 ? 'completed' : hasProgress(item) ? 'in_progress' : 'wishlist';
    const patch = {
      notes: el('editNotes').value.trim() || null,
      rating: rating || null,
      status,
      date_completed: rating > 0 ? item.date_completed || new Date().toISOString() : null,
      tags: rating > 0 ? getActiveChipValues('editReactionTagChips') : getActiveChipValues('editWishlistTagChips'),
    };
    if (item.status === 'in_progress') {
      if (item.media_type === 'book' && el('editProgressPercent')) {
        patch.progress_percent = parseInt(el('editProgressPercent').value, 10) || 0;
      }
      if (item.media_type === 'tv' && el('editProgressSeason')) {
        patch.progress_season = parseInt(el('editProgressSeason').value, 10) || 1;
        patch.progress_episode = parseInt(el('editProgressEpisode').value, 10) || 1;
      }
    }
    const updated = await store.updateItem(item.id, patch);
    const idx = items.findIndex((i) => i.id === item.id);
    items[idx] = updated;
    renderWishlist();
    renderJournal();
    closeModal();
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
    <label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:14px;cursor:pointer;">
      <input type="checkbox" id="alreadyDone" style="width:auto;">
      I've already experienced this
    </label>
    <div class="field" id="wishlistTagField">
      <label>Tags</label>
      ${tagChipsHtml('wishlistTagChips', WISHLIST_TAGS, [])}
    </div>
    <div id="ratingSection" class="hidden">
      <div class="field">
        <label>Your rating</label>
        ${starsEditableHtml('addStars', 0)}
      </div>
      <div class="field">
        <label>Tags</label>
        ${tagChipsHtml('reactionTagChips', REACTION_TAGS[prefill.media_type] || REACTION_TAGS.movie, [])}
      </div>
      <div class="field">
        <label for="addNotes">Notes</label>
        <textarea id="addNotes" placeholder="Thoughts, quotes, where you left off…"></textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn-primary" id="addSaveBtn" style="width:100%">Add</button>
    </div>
  `;
  openModalWithContent(html);
  wireStars('addStars');
  wireTagChips('wishlistTagChips');
  wireTagChips('reactionTagChips');
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('alreadyDone').addEventListener('change', (e) => {
    const done = e.target.checked;
    el('ratingSection').classList.toggle('hidden', !done);
    el('wishlistTagField').classList.toggle('hidden', done);
  });
  el('addType').addEventListener('change', () => {
    const options = REACTION_TAGS[el('addType').value] || REACTION_TAGS.movie;
    el('reactionTagChips').outerHTML = tagChipsHtml('reactionTagChips', options, []);
    wireTagChips('reactionTagChips');
  });

  el('addSaveBtn').addEventListener('click', async () => {
    const title = el('addTitle').value.trim();
    if (!title) {
      el('addTitle').focus();
      return;
    }
    const done = el('alreadyDone').checked;
    const rating = done ? getStarsValue('addStars') : 0;
    const payload = {
      media_type: el('addType').value,
      title,
      creator: el('addCreator').value.trim() || null,
      year: el('addYear').value.trim() || null,
      poster_url: prefill.poster_url || null,
      description: prefill.description || null,
      external_source: prefill.external_source || 'manual',
      external_id: prefill.external_id || null,
      external_url: prefill.external_url || null,
      status: done ? 'completed' : 'wishlist',
      rating: rating || null,
      notes: done ? el('addNotes').value.trim() || null : null,
      date_completed: done ? new Date().toISOString() : null,
      tags: done ? getActiveChipValues('reactionTagChips') : getActiveChipValues('wishlistTagChips'),
    };
    const saved = await store.addItem(payload);
    items.unshift(saved);
    renderWishlist();
    renderJournal();
    closeModal();
    document.querySelector(`.tab[data-tab="${done ? 'journal' : 'wishlist'}"]`).click();
  });
}

el('manualAddBtn').addEventListener('click', () => openAddModal({}));

// ---------- Discover ----------

async function runDiscoverSearch() {
  const query = el('discoverQuery').value.trim();
  if (!query) return;
  el('tab-discover').classList.remove('discover-empty');
  const type = el('discoverTypeChips').dataset.value;
  const btn = el('discoverSearchBtn');
  btn.disabled = true;
  btn.textContent = 'Searching…';
  el('discoverNotice').classList.add('hidden');

  const notices = [];
  if (!tmdbAvailable() && (type === 'all' || type === 'movie' || type === 'tv')) {
    notices.push('Add a free TMDb API key to js/config.js to search movies & TV — see README.');
  }

  const { results, errors } = await searchExternal(query, type);
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

  btn.disabled = false;
  btn.textContent = 'Search';
}

el('discoverSearchBtn').addEventListener('click', runDiscoverSearch);
el('discoverQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runDiscoverSearch();
});
wireChipGroup('discoverTypeChips', () => {
  if (el('discoverQuery').value.trim()) runDiscoverSearch();
});
