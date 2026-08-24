// Generates a 1080x1920 share image from a finished review and hands it to
// the OS share sheet. Instagram has no public posting API, so producing a
// file and letting the user pick the destination themselves is the only
// route that actually works — and it gets Messages, Photos, and everything
// else for free.
//
// THE POSTER PROBLEM
// Posters are cross-origin (image.tmdb.org, images.igdb.com,
// books.google.com, coverartarchive.org). Drawing one into a canvas taints
// it, and toBlob() then throws a SecurityError — no export at all. Setting
// crossOrigin='anonymous' avoids that, but only if the host actually sends
// an Access-Control-Allow-Origin header, and TMDb's are documented as
// inconsistent (present on some responses and not others for the same URL).
//
// So the poster is treated as best-effort: try to load it CORS-safely, and
// if that fails, render a typographic card built around the media type's
// own color instead. The fallback is designed to look like a deliberate
// second style rather than a broken first one.

const CARD_W = 1080;
const CARD_H = 1920;

const TYPE_EMOJI = {
  movie: '🍿', tv: '📺', book: '📚', podcast: '🎙️', album: '💿',
  game: '🎮', play: '🎭', restaurant: '🍽️', other: '✨',
};
const TYPE_LABEL = {
  movie: 'Movie', tv: 'TV Show', book: 'Book', podcast: 'Podcast',
  album: 'Album', game: 'Video Game', play: 'Play', restaurant: 'Restaurant',
  other: 'Other',
};

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const INK = '#ffffff';
const INK_DIM = 'rgba(255, 255, 255, 0.72)';
const INK_FAINT = 'rgba(255, 255, 255, 0.5)';

// The same per-type palette the Account page's pie and activity calendar
// use. They're CSS custom properties, so they have to be resolved against
// the live document rather than read as literals — and they differ between
// light and dark themes, so this picks up whichever is active.
function typeColor(mediaType) {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--type-${mediaType}`)
    .trim();
  return raw || '#898781';
}

// Mixes a hex color toward black, for backgrounds that need to sit behind
// white text without competing with it.
function darken(hex, amount) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

// Splits a single word that is itself wider than the line into chunks that
// fit. Without this, an unbroken run of characters — a URL, a long hashtag
// — is drawn past the card's right edge, since there's no space to break
// on and canvas happily overflows.
function breakLongWord(ctx, word, maxWidth) {
  const chunks = [];
  let chunk = '';
  for (const ch of word) {
    if (chunk && ctx.measureText(chunk + ch).width > maxWidth) {
      chunks.push(chunk);
      chunk = ch;
    } else {
      chunk += ch;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

// Canvas has no text wrapping of its own — this breaks on spaces and
// returns at most `maxLines`, ellipsizing the last one if there's more.
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (ctx.measureText(w).width > maxWidth ? breakLongWord(ctx, w, maxWidth) : [w]));
  const lines = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  if (lines.length === maxLines) {
    // Trim the final line until it fits with an ellipsis appended.
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length) {
      let last = lines[maxLines - 1];
      while (last && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1).trimEnd();
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function drawLines(ctx, lines, x, y, lineHeight) {
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Resolves to an HTMLImageElement, or null if the image can't be used on a
// canvas. onerror is the signal that matters: with crossOrigin set, a host
// that refuses CORS fails the load outright rather than loading a tainted
// image, which is exactly the distinction needed here.
function loadCorsImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // A browser that already cached this image without CORS (from the
    // ordinary <img> in the app UI) will replay that header-less response
    // and fail the load. A distinct URL sidesteps that cache entry.
    img.src = url + (url.includes('?') ? '&' : '?') + 'sharecard=1';
    // Some browsers resolve an already-complete image without firing
    // either handler.
    if (img.complete && img.naturalWidth) resolve(img);
  });
}

function starsText(rating) {
  const n = Math.max(0, Math.min(5, rating || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// Mirrors displayTitle() in js/app.js. A TV row carrying a season_number
// records one season rather than the whole show, and a shared card that just
// said "Severance" would misrepresent which season was rated.
function cardTitle(item) {
  const base = item.title || 'Untitled';
  return item.media_type === 'tv' && item.season_number != null
    ? `${base} · Season ${item.season_number}`
    : base;
}

function subtitleText(item) {
  return [TYPE_LABEL[item.media_type] || item.media_type, item.creator, item.year]
    .filter(Boolean)
    .join(' · ');
}

// Shared bottom half: title, subtitle, stars, notes, wordmark. Returns
// nothing; both layouts position their artwork above this and hand in the
// y coordinate to start from.
function drawDetails(ctx, item, top) {
  const pad = 96;
  const maxWidth = CARD_W - pad * 2;
  let y = top;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  ctx.fillStyle = INK;
  ctx.font = `700 68px ${FONT_STACK}`;
  y = drawLines(ctx, wrapLines(ctx, cardTitle(item), maxWidth, 3), pad, y, 82);

  const subtitle = subtitleText(item);
  if (subtitle) {
    y += 14;
    ctx.fillStyle = INK_DIM;
    ctx.font = `500 36px ${FONT_STACK}`;
    y = drawLines(ctx, wrapLines(ctx, subtitle, maxWidth, 2), pad, y, 46);
  }

  if (item.rating) {
    y += 26;
    ctx.fillStyle = '#ffb020';
    ctx.font = `400 58px ${FONT_STACK}`;
    ctx.fillText(starsText(item.rating), pad, y);
    y += 76;
  }

  if (item.notes) {
    y += 20;
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 38px ${FONT_STACK}`;
    // Line budget is whatever vertical room is left above the wordmark.
    const available = CARD_H - 150 - y;
    const maxLines = Math.max(0, Math.floor(available / 54));
    if (maxLines > 0) drawLines(ctx, wrapLines(ctx, item.notes, maxWidth, maxLines), pad, y, 54);
  }

  ctx.fillStyle = INK_FAINT;
  ctx.font = `600 32px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Media Journal', pad, CARD_H - 88);
}

function drawWithPoster(ctx, item, img) {
  const accent = typeColor(item.media_type);

  ctx.fillStyle = darken(accent, 0.82);
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Poster sized to a 2:3 box, cover-cropped so odd aspect ratios (book
  // and album art especially) fill it without distortion.
  //
  // Deliberately smaller than the space available: a three-line title plus
  // a bigger poster left roughly one line for the notes, and the notes are
  // the actual review. Artwork gives way to words here.
  const boxW = 560;
  const boxH = 840;
  const boxX = (CARD_W - boxW) / 2;
  const boxY = 110;
  const scale = Math.max(boxW / img.naturalWidth, boxH / img.naturalHeight);
  const drawW = img.naturalWidth * scale;
  const drawH = img.naturalHeight * scale;

  ctx.save();
  roundedRect(ctx, boxX, boxY, boxW, boxH, 28);
  ctx.clip();
  ctx.drawImage(img, boxX + (boxW - drawW) / 2, boxY + (boxH - drawH) / 2, drawW, drawH);
  ctx.restore();

  drawDetails(ctx, item, boxY + boxH + 70);
}

// No usable poster: the media type's color carries the card instead, with
// its emoji standing in for the artwork. Same typography below, so the two
// layouts read as siblings.
function drawWithoutPoster(ctx, item) {
  const accent = typeColor(item.media_type);

  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_H);
  gradient.addColorStop(0, darken(accent, 0.35));
  gradient.addColorStop(1, darken(accent, 0.86));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 300px ${FONT_STACK}`;
  ctx.fillText(TYPE_EMOJI[item.media_type] || TYPE_EMOJI.other, CARD_W / 2, 470);

  drawDetails(ctx, item, 720);
}

// Renders the card and resolves with a PNG Blob. Exported separately from
// the sharing so tests (and any future preview UI) can get at the image
// without invoking the share sheet.
export async function renderReviewCard(item) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');

  const img = await loadCorsImage(item.poster_url);
  if (img) drawWithPoster(ctx, item, img);
  else drawWithoutPoster(ctx, item);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not generate the image.'));
      }, 'image/png');
    } catch (err) {
      // Belt and braces: loadCorsImage should already have prevented a
      // tainted canvas, but a SecurityError here would otherwise surface
      // as an unhandled throw rather than a message.
      reject(new Error(`Could not generate the image: ${err.message}`));
    }
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function safeFilename(title) {
  return (title || 'review').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'review';
}

// Generates the card and hands it off. Returns 'shared' | 'downloaded' so
// the caller can tell the user what actually happened — on desktop the
// share sheet often isn't available and a file lands in Downloads instead,
// which is worth saying out loud rather than looking like nothing happened.
export async function shareReviewCard(item) {
  const blob = await renderReviewCard(item);
  const file = new File([blob], `${safeFilename(cardTitle(item))}.png`, { type: 'image/png' });

  // canShare({ files }) is the guard that matters — navigator.share can
  // exist while file sharing specifically is unsupported.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: cardTitle(item) });
      return 'shared';
    } catch (err) {
      // The user dismissing the share sheet throws AbortError. That's not
      // a failure and shouldn't fall through to a surprise download.
      if (err && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }

  downloadBlob(blob, file.name);
  return 'downloaded';
}
