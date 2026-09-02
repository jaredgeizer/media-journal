// Re-serves a poster image with an Access-Control-Allow-Origin header, so
// the share card can draw it onto a canvas and still export it.
//
// WHY THIS EXISTS
// js/sharecard.js loads posters with crossOrigin='anonymous', because
// drawing a cross-origin image without it taints the canvas and toBlob()
// then throws — no image at all. But that only works when the host actually
// sends the CORS header, and the poster hosts disagree:
//
//   image.tmdb.org        usually yes, documented as inconsistent
//   books.google.com      no — this is the one that sent a book's card to
//                         the typographic fallback even though the cover
//                         renders fine in the app, where a plain <img>
//                         needs no CORS at all
//   coverartarchive.org   redirects to archive.org, headers vary
//   images.igdb.com       no
//
// Deno's fetch() here isn't subject to CORS — CORS only restricts requests
// a browser issues — so this fetches the bytes server-side and hands them
// back with the header attached.
//
// DEPLOYING: create a function with the slug "poster-proxy" and turn
// "Verify JWT" OFF in its Settings tab. That matters more here than it did
// for the search function: an <img> tag cannot send an Authorization
// header, so a function that demands one can never be used as an image
// source. The client also appends the public anon key as a query
// parameter, which some gateway configurations want.
//
// The client tries the poster host directly first and only falls back to
// this, so if it is never deployed nothing regresses — cards keep behaving
// exactly as they do today.

// An open proxy is a liability: anything that will fetch an arbitrary URL
// on request can be pointed at internal addresses or used to launder
// traffic. So this fetches nothing but poster hosts the app itself uses.
//
// Exact hostnames.
const ALLOWED_HOSTS = new Set([
  'image.tmdb.org',
  'books.google.com',
  'books.googleusercontent.com',
  'coverartarchive.org',
  'images.igdb.com',
]);

// Hosts with per-shard subdomains, matched as "the domain itself, or
// something under it". Written as `host === base || host.endsWith('.' +
// base)` rather than a bare endsWith, which would also accept
// "evil-mzstatic.com".
const ALLOWED_SUFFIXES = ['mzstatic.com', 'us.archive.org', 'archive.org'];

const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 3;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function fail(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  if (ALLOWED_HOSTS.has(h)) return true;
  return ALLOWED_SUFFIXES.some((base) => h === base || h.endsWith(`.${base}`));
}

// Parses and vets a candidate URL. https only — http would let a redirect
// or a typo reach something plaintext on the local network.
function vetUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!hostAllowed(url.hostname)) return null;
  return url;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Manual redirects so every hop is vetted, not just the first.
    // coverartarchive.org redirects to archive.org, and a proxy that
    // followed redirects blindly would let an allowed host hand it an
    // arbitrary destination.
    return await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'image/*' },
    });
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail('Use GET.', 405);

  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return fail('Missing ?url=', 400);

  let target = vetUrl(raw);
  if (!target) return fail('That URL is not a poster host this proxy serves.', 400);

  let res: Response;
  try {
    res = await fetchWithTimeout(target.toString());
    for (let hop = 0; hop < MAX_REDIRECTS && res.status >= 300 && res.status < 400; hop += 1) {
      const location = res.headers.get('location');
      if (!location) break;
      const next = vetUrl(new URL(location, target).toString());
      if (!next) return fail('Image redirected somewhere this proxy will not follow.', 502);
      target = next;
      res = await fetchWithTimeout(target.toString());
    }
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return fail(aborted ? 'The image host timed out.' : `Could not fetch the image: ${(err as Error).message}`, 502);
  }

  if (!res.ok) return fail(`The image host returned ${res.status}.`, 502);

  // Whatever comes back has to actually be an image. Without this the proxy
  // would happily re-serve an HTML error page — or anything else — from an
  // allowed host under a same-origin-ish URL.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    return fail(`Expected an image, got ${contentType || 'no content type'}.`, 502);
  }

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return fail('That image is too large.', 413);

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return fail('That image is too large.', 413);

  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      // Posters never change under a given URL, and a share card is often
      // generated more than once for the same item.
      'Cache-Control': 'public, max-age=86400',
    },
  });
});
