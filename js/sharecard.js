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
// So the poster is treated as best-effort, in three steps: load it
// CORS-safely from the host; failing that, through the poster-proxy Edge
// Function, which re-serves the bytes with the header attached; failing
// that, render a typographic card built around the media type's own color.
// The fallback is designed to look like a deliberate second style rather
// than a broken first one — but it should now be rare, where before it was
// guaranteed for every book (books.google.com never sends the header).
//
// THE BACKDROP
// Both layouts sit on the same generated background: a colour pulled out of
// the poster (or the media type's, when there's no poster to read), with
// contour lines drawn over it from a random height field seeded by the
// item's id. Same review, same terrain; different reviews, different
// terrain.

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

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

// h is 0..1 to match rgbToHsl; everything else here thinks in fractions too.
function hsl(h, s, l, a = 1) {
  const deg = ((h % 1) + 1) % 1;
  return `hsla(${(deg * 360).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a})`;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The card's colour, pulled from the poster itself.
//
// Not the most *common* colour — that's almost always the near-black or
// near-white the artwork sits on, which would make every card look the
// same. Instead: throw away pixels too dark, too pale or too grey to say
// anything, bucket what's left by hue, and take the heaviest bucket
// weighted by how vivid and how mid-toned each pixel is. That's the colour
// a person would point at if you asked what colour the poster is.
//
// Returns {h, s, l} or null when the poster has nothing to offer (a
// black-and-white cover, say), leaving the caller to fall back to the
// media type's own colour.
function posterColor(img) {
  const W = 48;
  const H = 72;
  const sample = document.createElement('canvas');
  sample.width = W;
  sample.height = H;
  const sctx = sample.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, W, H);

  let data;
  try {
    data = sctx.getImageData(0, 0, W, H).data;
  } catch (err) {
    // loadCorsImage() should have ruled this out — the image only resolves
    // when the host allowed CORS — but a tainted canvas here would throw
    // SecurityError and take the whole card down over a background colour.
    return null;
  }

  const BUCKETS = 24;
  const weights = new Float64Array(BUCKETS);
  const sums = Array.from({ length: BUCKETS }, () => ({ s: 0, l: 0, w: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const { h, s, l } = rgbToHsl({ r: data[i], g: data[i + 1], b: data[i + 2] });
    if (l < 0.12 || l > 0.92 || s < 0.15) continue;
    // Vivid and mid-toned pixels speak loudest.
    const weight = s * (1 - Math.abs(l - 0.5) * 1.4);
    if (weight <= 0) continue;
    const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
    weights[bucket] += weight;
    sums[bucket].s += s * weight;
    sums[bucket].l += l * weight;
    sums[bucket].w += weight;
  }

  let best = -1;
  for (let i = 0; i < BUCKETS; i += 1) {
    if (weights[i] > (best === -1 ? 0 : weights[best])) best = i;
  }
  if (best === -1) return null;

  return {
    h: (best + 0.5) / BUCKETS,
    s: sums[best].s / sums[best].w,
    l: sums[best].l / sums[best].w,
  };
}

// Turns whatever colour we ended up with into one that can sit behind white
// text. Hue is kept exactly; saturation is floored so it doesn't wash out
// to grey and capped so it doesn't vibrate; lightness is set outright
// rather than scaled, so a black poster and a neon one both land somewhere
// legible instead of one going pure black and the other staying bright.
function backdrop(base) {
  return { h: base.h, s: clamp(base.s, 0.3, 0.62) };
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

// ---------------------------------------------------------------------------
// The topographic backdrop
//
// Contour lines over a smooth random field, so every card gets its own
// terrain. The seed comes from the item's id, which means the pattern is
// different for every review but the same one twice for the same review —
// re-sharing a card doesn't quietly produce different art. Swap the seed
// for Math.random() if it should re-roll on every share instead.
// ---------------------------------------------------------------------------

// mulberry32: small, fast, and good enough for decoration.
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str).length; i += 1) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A height field: a few plane waves for the ridged, banded structure, plus
// a handful of radial bumps and hollows. The bumps are what matter — pure
// waves give stripes, and it's the closed loops around a peak or a basin
// that make the eye read "map" rather than "pattern".
function makeHeightField(rng) {
  const waves = [];
  const waveCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < waveCount; i += 1) {
    const angle = rng() * Math.PI * 2;
    const freq = 0.0016 + rng() * 0.0042;
    waves.push({
      ax: Math.cos(angle) * freq,
      ay: Math.sin(angle) * freq,
      phase: rng() * Math.PI * 2,
      amp: 0.5 + rng() * 0.7,
    });
  }

  const bumps = [];
  const bumpCount = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < bumpCount; i += 1) {
    bumps.push({
      x: rng() * CARD_W,
      y: rng() * CARD_H,
      r: 240 + rng() * 620,
      amp: (rng() < 0.5 ? -1 : 1) * (1.2 + rng() * 1.8),
    });
  }

  return (x, y) => {
    let v = 0;
    for (const w of waves) v += w.amp * Math.sin(x * w.ax + y * w.ay + w.phase);
    for (const b of bumps) {
      const dx = (x - b.x) / b.r;
      const dy = (y - b.y) / b.r;
      v += b.amp * Math.exp(-(dx * dx + dy * dy));
    }
    return v;
  };
}

// Marching squares. Each cell contributes at most two line segments, with
// the crossing points linearly interpolated along the edges — that
// interpolation is the difference between smooth contours and visible
// stair-stepping at this grid size.
function contourSegments(grid, cols, rows, step, level, out) {
  const at = (i, j) => grid[j * cols + i];
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const v0 = at(i, j);
      const v1 = at(i + 1, j);
      const v2 = at(i + 1, j + 1);
      const v3 = at(i, j + 1);
      let idx = 0;
      if (v0 > level) idx |= 8;
      if (v1 > level) idx |= 4;
      if (v2 > level) idx |= 2;
      if (v3 > level) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      const x = i * step;
      const y = j * step;
      const top = () => [x + step * ((level - v0) / (v1 - v0)), y];
      const right = () => [x + step, y + step * ((level - v1) / (v2 - v1))];
      const bottom = () => [x + step * ((level - v3) / (v2 - v3)), y + step];
      const left = () => [x, y + step * ((level - v0) / (v3 - v0))];

      switch (idx) {
        case 1: case 14: out.push([left(), bottom()]); break;
        case 2: case 13: out.push([bottom(), right()]); break;
        case 3: case 12: out.push([left(), right()]); break;
        case 4: case 11: out.push([top(), right()]); break;
        case 6: case 9: out.push([top(), bottom()]); break;
        case 7: case 8: out.push([left(), top()]); break;
        // Saddles: two crossings in one cell. Either pairing is defensible
        // and neither is visibly wrong at this scale.
        case 5: out.push([left(), top()], [bottom(), right()]); break;
        case 10: out.push([top(), right()], [left(), bottom()]); break;
        default: break;
      }
    }
  }
}

function drawTopography(ctx, rng, tint) {
  const step = 12;
  const cols = Math.ceil(CARD_W / step) + 1;
  const rows = Math.ceil(CARD_H / step) + 1;
  const field = makeHeightField(rng);

  const grid = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const v = field(i * step, j * step);
      grid[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max - min < 1e-6) return;

  const levelCount = 26 + Math.floor(rng() * 12);
  // Inset from the extremes: a contour drawn at the exact minimum or
  // maximum hugs a single point and reads as a speck, not a line.
  const lo = min + (max - min) * 0.06;
  const hi = max - (max - min) * 0.06;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (let n = 0; n < levelCount; n += 1) {
    const level = lo + ((hi - lo) * n) / (levelCount - 1);
    const segments = [];
    contourSegments(grid, cols, rows, step, level, segments);
    if (!segments.length) continue;

    // Every fifth line heavier, the way an index contour is on a real
    // topographic map — it gives the field a sense of depth that evenly
    // weighted lines don't.
    const index = n % 5 === 0;
    ctx.lineWidth = index ? 3 : 1.6;
    ctx.strokeStyle = hsl(tint.h, tint.s * 0.85, 0.78, index ? 0.17 : 0.09);

    ctx.beginPath();
    for (const [a, b] of segments) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// Background, then contours, then a vertical wash that pushes the lines
// back where the text sits so nothing has to compete with them.
function drawBackdrop(ctx, tint, seed) {
  const base = ctx.createLinearGradient(0, 0, 0, CARD_H);
  base.addColorStop(0, hsl(tint.h, tint.s, 0.17));
  base.addColorStop(1, hsl(tint.h, tint.s * 0.9, 0.06));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  drawTopography(ctx, makeRng(seed), tint);

  const wash = ctx.createLinearGradient(0, CARD_H * 0.55, 0, CARD_H);
  wash.addColorStop(0, hsl(tint.h, tint.s, 0.06, 0));
  wash.addColorStop(1, hsl(tint.h, tint.s, 0.04, 0.42));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
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

// The Edge Function that re-serves a poster with a CORS header
// (supabase/functions/poster-proxy). Null when the app isn't connected to a
// Supabase project — Demo Mode has no function to call.
//
// The anon key rides along as a query parameter because an <img> can't send
// headers. It's the same public key already sitting in js/config.js, and it
// grants nothing on its own; the row-level policies are what protect data.
function proxiedPosterUrl(url) {
  const cfg = window.MEDIA_JOURNAL_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !url) return null;
  const params = new URLSearchParams({ url, apikey: cfg.supabaseAnonKey });
  return `${cfg.supabaseUrl}/functions/v1/poster-proxy?${params}`;
}

// Direct first, proxy second, give up third.
//
// Direct costs nothing when it works — image.tmdb.org usually does — and
// keeps the card independent of the Edge Function. The proxy is what
// rescues the hosts that refuse CORS outright: books.google.com never sends
// the header, which is why a book's cover renders perfectly well in the app
// (a plain <img> needs no CORS) and yet produced the typographic fallback
// card. If the proxy isn't deployed, this simply fails too and the fallback
// still catches it.
async function loadPoster(url) {
  if (!url) return null;
  const direct = await loadCorsImage(url);
  if (direct) return direct;
  const proxied = proxiedPosterUrl(url);
  return proxied ? loadCorsImage(proxied) : null;
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

// Shared bottom half: title, subtitle, stars, notes, wordmark — all centred
// on the card's axis, under the artwork. Returns nothing; both layouts
// position their artwork above this and hand in the y coordinate to start
// from.
function drawDetails(ctx, item, top) {
  const pad = 96;
  const maxWidth = CARD_W - pad * 2;
  const mid = CARD_W / 2;
  let y = top;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillStyle = INK;
  ctx.font = `700 68px ${FONT_STACK}`;
  y = drawLines(ctx, wrapLines(ctx, cardTitle(item), maxWidth, 3), mid, y, 82);

  const subtitle = subtitleText(item);
  if (subtitle) {
    y += 14;
    ctx.fillStyle = INK_DIM;
    ctx.font = `500 36px ${FONT_STACK}`;
    y = drawLines(ctx, wrapLines(ctx, subtitle, maxWidth, 2), mid, y, 46);
  }

  if (item.rating) {
    y += 26;
    ctx.fillStyle = '#ffb020';
    ctx.font = `400 58px ${FONT_STACK}`;
    ctx.fillText(starsText(item.rating), mid, y);
    y += 76;
  }

  if (item.notes) {
    y += 20;
    ctx.fillStyle = INK_DIM;
    ctx.font = `400 38px ${FONT_STACK}`;
    // Line budget is whatever vertical room is left above the wordmark.
    const available = CARD_H - 150 - y;
    const maxLines = Math.max(0, Math.floor(available / 54));
    if (maxLines > 0) drawLines(ctx, wrapLines(ctx, item.notes, maxWidth, maxLines), mid, y, 54);
  }

  ctx.fillStyle = INK_FAINT;
  ctx.font = `600 32px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Media Journal', mid, CARD_H - 88);
}

function drawWithPoster(ctx, item, img) {
  // The poster's own colour where it has one to give; the media type's
  // otherwise, which is what a black-and-white cover falls back to.
  const pulled = posterColor(img) || rgbToHsl(parseHex(typeColor(item.media_type)) || { r: 137, g: 135, b: 129 });
  drawBackdrop(ctx, backdrop(pulled), hashString(item.id || item.title || 'card'));

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
  const accent = rgbToHsl(parseHex(typeColor(item.media_type)) || { r: 137, g: 135, b: 129 });
  drawBackdrop(ctx, backdrop(accent), hashString(item.id || item.title || 'card'));

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

  const img = await loadPoster(item.poster_url);
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
