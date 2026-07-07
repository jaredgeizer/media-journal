import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable } from './search.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', play: 'Play', restaurant: 'Restaurant', other: 'Other' };

const store = createStore();
let items = [];

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

function cardHtml(item) {
  return `
    <div class="card glass" data-item-id="${item.id}">
      <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
      ${posterOrEmoji(item)}
      <div class="card-body">
        <p class="card-title">${escapeHtml(item.title)}</p>
        <p class="card-meta">${metaLine(item)}</p>
        ${item.rating ? `<div class="card-stars">${'★'.repeat(item.rating)}${'☆'.repeat(5 - item.rating)}</div>` : ''}
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
        ${item.notes ? `<p class="journal-entry-notes">${escapeHtml(item.notes)}</p>` : ''}
      </div>
    </div>`;
}

function discoverCardHtml(item, idx) {
  return `
    <div class="card glass" data-idx="${idx}">
      <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
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
    type: el(prefix + 'TypeFilter').value,
  };
}

function matches(item, { text, type }) {
  if (type !== 'all' && item.media_type !== type) return false;
  if (!text) return true;
  const hay = [item.title, item.creator, item.notes].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(text);
}

function renderWishlist() {
  const filters = getFilters('wishlist');
  const list = items
    .filter((i) => i.status === 'wishlist' && matches(i, filters))
    .sort((a, b) => new Date(b.date_added) - new Date(a.date_added));
  const grid = el('wishlistGrid');
  grid.innerHTML = list.map(cardHtml).join('');
  el('wishlistEmpty').classList.toggle('hidden', list.length > 0);
  grid.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
}

function renderJournal() {
  const filters = getFilters('journal');
  const list = items
    .filter((i) => i.status === 'completed' && matches(i, filters))
    .sort((a, b) => new Date(b.date_completed || b.updated_at || 0) - new Date(a.date_completed || a.updated_at || 0));
  const feed = el('journalFeed');
  feed.innerHTML = list.map(journalEntryHtml).join('');
  el('journalEmpty').classList.toggle('hidden', list.length > 0);
  feed.querySelectorAll('[data-item-id]').forEach((node) => {
    node.addEventListener('click', () => openEditModal(items.find((i) => i.id === node.dataset.itemId)));
  });
}

el('wishlistFilter').addEventListener('input', renderWishlist);
el('wishlistTypeFilter').addEventListener('change', renderWishlist);
el('journalFilter').addEventListener('input', renderJournal);
el('journalTypeFilter').addEventListener('change', renderJournal);

// ---------- Stars widget ----------

function starsEditableHtml(id, rating) {
  let html = `<div class="stars" id="${id}" data-rating="${rating || 0}">`;
  for (let v = 1; v <= 5; v++) {
    html += `<button type="button" data-value="${v}" class="${v <= (rating || 0) ? 'filled' : ''}">★</button>`;
  }
  html += `</div>`;
  return html;
}

function wireStars(id) {
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
    ${item.description ? `<p class="journal-entry-notes" style="-webkit-line-clamp:unset;margin-bottom:16px;color:var(--text-secondary)">${escapeHtml(item.description)}</p>` : ''}
    <div class="field">
      <label>Your rating</label>
      ${starsEditableHtml('editStars', item.rating)}
      <p style="font-size:12px;color:var(--text-tertiary);margin-top:6px;">${item.status === 'wishlist' ? 'Rate it to move it to your journal.' : 'Clear the rating to move this back to your wishlist.'}</p>
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
  wireStars('editStars');
  el('modalCloseBtn').addEventListener('click', closeModal);

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
    const patch = {
      notes: el('editNotes').value.trim() || null,
      rating: rating || null,
      status: rating > 0 ? 'completed' : 'wishlist',
      date_completed: rating > 0 ? item.date_completed || new Date().toISOString() : null,
    };
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
    <div id="ratingSection" class="hidden">
      <div class="field">
        <label>Your rating</label>
        ${starsEditableHtml('addStars', 0)}
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
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('alreadyDone').addEventListener('change', (e) => {
    el('ratingSection').classList.toggle('hidden', !e.target.checked);
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
      status: done ? 'completed' : 'wishlist',
      rating: rating || null,
      notes: done ? el('addNotes').value.trim() || null : null,
      date_completed: done ? new Date().toISOString() : null,
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
  const type = el('discoverTypeFilter').value;
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
