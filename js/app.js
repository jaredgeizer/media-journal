import { createStore } from './storage.js';
import { search as searchExternal, tmdbAvailable } from './search.js';

const TYPE_EMOJI = { movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', play: '🎭', restaurant: '🍽️', other: '✨' };
const TYPE_LABEL = { movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast', play: 'Play', restaurant: 'Restaurant', other: 'Other' };
const EXTERNAL_LINK_LABEL = { itunes: '🎧 Open in Apple Podcasts', google_books: '📖 View on Google Books' };
const COMPLETED_VERB = { movie: 'Watched', tv: 'Watched', book: 'Read', podcast: 'Listened', play: 'Seen', restaurant: 'Been', other: 'Done' };

const PROGRESS_TYPES = ['book', 'tv'];
const WISHLIST_TAGS = ['⭐ Shortlist', '👍 Recommended'];

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
    el('accountMenu').classList.remove('hidden');
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

el('accountBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  el('accountDropdown').classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  const dropdown = el('accountDropdown');
  if (!dropdown.classList.contains('hidden') && !e.target.closest('.account-menu')) {
    dropdown.classList.add('hidden');
  }
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

// ---------- Responsive nav placement ----------
// On desktop, the Journal/Wishlist pills and the Discover + button live in
// the header next to the title/account icon; on mobile they live in their
// own fixed bottom bar. Physically relocate the nodes rather than
// duplicating them, so all their listeners keep working either way.

const desktopNavQuery = window.matchMedia('(min-width: 681px)');

function applyResponsiveNav(isDesktop) {
  const pills = document.querySelector('.tabbar-pills');
  const fab = el('discoverFabBtn');
  const nav = document.querySelector('.tabbar');
  const topbarLeft = el('topbarLeft');
  const topbarRight = el('topbarRight');

  if (isDesktop) {
    topbarLeft.appendChild(pills);
    topbarRight.insertBefore(fab, el('accountMenu'));
    nav.classList.add('hidden');
  } else {
    nav.insertBefore(pills, nav.firstChild);
    nav.appendChild(fab);
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
  used.delete('Favorite');
  return ['Favorite', ...Array.from(used).sort((a, b) => a.localeCompare(b))];
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
          <input type="number" id="editProgressPercentNumber" min="0" max="100" value="${pct}">
          <span class="progress-subtext">%</span>
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
  if (item.media_type === 'book') {
    const pct = item.progress_percent || 0;
    return `
      <div class="currently-card glass" data-item-id="${item.id}">
        <div class="card-type-badge">${TYPE_EMOJI[item.media_type]} ${TYPE_LABEL[item.media_type]}</div>
        ${posterOrEmoji(item, 'currently-card-poster')}
        <div class="card-body">
          <p class="card-title">${escapeHtml(item.title)}</p>
          <input type="range" class="currently-progress-slider" min="0" max="100" value="${pct}" data-progress-id="${item.id}">
          <div class="currently-progress-row">
            <input type="number" class="currently-progress-number" min="0" max="100" value="${pct}" data-progress-number-id="${item.id}">
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
        <p class="progress-badge">${progressText}</p>
        <button type="button" class="btn-secondary next-episode-btn" data-next-episode-id="${item.id}">Next Episode</button>
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
  feed.querySelectorAll('[data-next-episode-id]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.nextEpisodeId;
      const current = items.find((i) => i.id === id);
      const updated = await store.updateItem(id, { progress_episode: (current.progress_episode || 1) + 1 });
      const idx = items.findIndex((i) => i.id === id);
      items[idx] = updated;
      renderCurrently();
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
      current.status === 'wishlist' && PROGRESS_TYPES.includes(current.media_type)
        ? `<button type="button" class="btn-secondary" id="startProgressBtn" style="width:100%;margin-bottom:12px;">${current.media_type === 'book' ? '📖 Start Reading' : '📺 Start Watching'}</button>`
        : ''
    }
    ${progressFieldHtml(current)}
    ${
      current.status === 'wishlist'
        ? `<div class="field" id="wishlistTagField"><label>Tags</label>${tagChipsHtml('editWishlistTagChips', WISHLIST_TAGS, current.tags || [])}</div>`
        : ''
    }
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

  if (current.status === 'in_progress' && current.media_type === 'book') {
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
  if (current.status === 'in_progress' && current.media_type === 'tv') {
    el('editProgressSeason').addEventListener('change', (e) => {
      persist({ progress_season: parseInt(e.target.value, 10) || 1 });
    });
    el('editProgressEpisode').addEventListener('change', (e) => {
      persist({ progress_episode: parseInt(e.target.value, 10) || 1 });
    });
  }

  const startBtn = el('startProgressBtn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const patch =
        current.media_type === 'book'
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
      const updated = await persist({ status: 'completed', date_completed: current.date_completed || new Date().toISOString() });
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
      <button type="button" class="btn-secondary" id="addWatchedBtn">✓ Mark as Watched</button>
      <button type="button" class="btn-secondary hidden" id="addCurrentlyBtn">▶ Currently Reading</button>
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
    el('addCurrentlyBtn').textContent = type === 'book' ? '📖 Currently Reading' : '📺 Currently Watching';
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
    const progress = draft.media_type === 'book' ? { progress_percent: 0 } : { progress_season: 1, progress_episode: 1 };
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
