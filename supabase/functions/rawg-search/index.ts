// Proxies video game search to RAWG (api.rawg.io) server-side. RAWG
// doesn't send an Access-Control-Allow-Origin header for arbitrary
// browser origins, so a direct fetch() from js/search.js gets blocked by
// the browser's own CORS policy before any response ever comes back
// (shows up as "Load failed"/"Failed to fetch", and no amount of
// client-side retrying can fix it — the request never actually leaves
// the browser). Deno's fetch() here isn't subject to CORS at all, since
// CORS only restricts browser-issued requests.
//
// A deliberately thin proxy: takes a query, calls RAWG, returns its JSON
// response unchanged. No per-user data and no auth required (unlike the
// old sync-steam-wishlist function this is modeled on), so there's no
// Authorization/JWT handling here — just the RAWG key, kept server-side
// as a secret instead of exposed in js/config.js like it used to be.
// This function's own "Verify JWT" setting needs to be OFF in the
// dashboard (Settings tab) for the same reason — there's no user auth to
// verify.
//
// The RAWG fetch is wrapped in a hard timeout: without one, an outbound
// request that never gets a response (rather than a clean error) hangs
// until Supabase's own platform gives up, which surfaces to the client
// as an opaque Cloudflare 522 with zero diagnostic info. A deliberate
// timeout fails fast with a clear message instead — useful in general,
// and specifically because RAWG (or an anti-bot layer in front of it)
// may be silently dropping requests from cloud/datacenter IP ranges,
// which is exactly the kind of range Supabase Edge Functions run on.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RAWG_TIMEOUT_MS = 8000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const RAWG_API_KEY = Deno.env.get('RAWG_API_KEY');
  if (!RAWG_API_KEY) return json({ error: 'RAWG_API_KEY is not set — add it under Edge Functions → Secrets.' }, 500);

  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') return json({ error: 'Missing "query" in request body.' }, 400);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RAWG_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `https://api.rawg.io/api/games?key=${encodeURIComponent(RAWG_API_KEY)}&search=${encodeURIComponent(query)}&page_size=20`,
        { signal: controller.signal }
      );
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return json({ error: `RAWG request timed out after ${RAWG_TIMEOUT_MS / 1000}s — RAWG may be blocking requests from this server.` }, 504);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    // Read as text first — safe whether RAWG returns JSON, HTML, or plain
    // text (a rate-limit/block page won't be JSON), so a non-JSON
    // response doesn't just look like a generic parse failure with no
    // real detail.
    const bodyText = await res.text();
    if (!res.ok) {
      let detail = bodyText.slice(0, 300);
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && parsed.detail) detail = parsed.detail;
      } catch {
        // not JSON — the raw text snippet is informative on its own
      }
      return json({ error: `RAWG responded with ${res.status} ${res.statusText} — ${detail}` }, res.status);
    }
    const data = JSON.parse(bodyText);
    return json(data);
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
