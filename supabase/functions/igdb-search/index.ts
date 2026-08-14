// Proxies video game search to IGDB (api.igdb.com) server-side. Like RAWG
// before it, IGDB doesn't send an Access-Control-Allow-Origin header for
// arbitrary browser origins, so a direct fetch() from js/search.js gets
// blocked by the browser's own CORS policy before any response ever comes
// back. Deno's fetch() here isn't subject to CORS at all, since CORS only
// restricts browser-issued requests.
//
// Replaced RAWG, which proved unreliable: RAWG's own status history showed
// repeated multi-day outages (9 in one 30-day window) plus independently
// reported response times over 10s even when up. IGDB is Twitch/Amazon-run
// and materially more stable.
//
// NOTE ON THE DEPLOYED URL: this function lives at the slug "super-task" in
// the Supabase dashboard, not "igdb-search" — the dashboard's "Deploy a new
// function -> Via Editor" flow kept an internal slug from a starter template,
// separate from the display name typed in afterward. The directory here is
// named for what the code does; js/search.js calls the real URL. Deploy by
// pasting this into that existing function, not by creating a new one.
//
// No per-user data and no auth required, so there's no Authorization/JWT
// handling for *our* callers — this function's own "Verify JWT" setting
// needs to be OFF in the dashboard (Settings tab) for that reason.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Well below the 25s RAWG needed — IGDB responds in well under a second
// normally, so a request still pending this long is broken, not slow.
// Applies to the Twitch token call and the IGDB call separately.
const IGDB_TIMEOUT_MS = 15000;

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GAMES_URL = 'https://api.igdb.com/v4/games';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Wraps fetch in a hard timeout: without one, an outbound request that never
// gets a response (rather than erroring cleanly) hangs until Supabase's own
// platform gives up, which surfaces to the client as an opaque Cloudflare 522
// with zero diagnostic info.
async function fetchWithTimeout(url: string, options: RequestInit, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IGDB_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error(`${label} timed out after ${IGDB_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// IGDB auth is two-step: exchange the Twitch client id/secret for an app
// access token, then send that token (plus the client id) on every API call.
// Tokens last ~60 days, so minting one per request would be wasteful and
// would double every search's latency. Module scope persists for the life of
// a warm Edge Function instance, so this caches across requests and only
// pays the extra round-trip on a cold start.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  // 60s of slack so a token that's about to lapse mid-request gets replaced
  // rather than used and rejected.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetchWithTimeout(`${TOKEN_URL}?${params}`, { method: 'POST' }, 'Twitch token request');

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Twitch token request failed (${res.status} ${res.statusText}) — ${bodyText.slice(0, 300)}`);
  }
  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`Twitch returned a non-JSON token response — ${bodyText.slice(0, 300)}`);
  }
  if (!parsed.access_token) {
    throw new Error('Twitch token response had no access_token.');
  }

  cachedToken = {
    value: parsed.access_token,
    // expires_in is seconds; fall back to an hour if it's ever missing so a
    // malformed response can't cache a token forever.
    expiresAt: Date.now() + (parsed.expires_in ? parsed.expires_in * 1000 : 3_600_000),
  };
  return cachedToken.value;
}

// Apicalypse (IGDB's query language) takes a plain-text body, and the search
// term sits inside double quotes — so quotes and backslashes in a user's
// query have to be escaped or they'd terminate the string and corrupt the
// query.
function escapeApicalypse(query: string) {
  return query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const IGDB_CLIENT_ID = Deno.env.get('IGDB_CLIENT_ID');
  const IGDB_CLIENT_SECRET = Deno.env.get('IGDB_CLIENT_SECRET');
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    return json(
      { error: 'IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must both be set — add them under Edge Functions → Secrets.' },
      500
    );
  }

  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') return json({ error: 'Missing "query" in request body.' }, 400);

    const token = await getAccessToken(IGDB_CLIENT_ID, IGDB_CLIENT_SECRET);

    // `where version_parent = null` drops alternate editions/ports that would
    // otherwise crowd out the base game (IGDB models "Game of the Year
    // Edition"-style entries as children of the original). `search` sorts by
    // relevance on its own, so no explicit sort clause.
    const body = [
      `search "${escapeApicalypse(query)}";`,
      'fields name,slug,summary,first_release_date,cover.image_id,genres.name,total_rating_count;',
      'where version_parent = null;',
      'limit 20;',
    ].join(' ');

    const res = await fetchWithTimeout(
      GAMES_URL,
      {
        method: 'POST',
        headers: {
          'Client-ID': IGDB_CLIENT_ID,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body,
      },
      'IGDB request'
    );

    // Read as text first — safe whether IGDB returns JSON, HTML, or plain
    // text (a rate-limit or block page won't be JSON), so a non-JSON response
    // doesn't just look like a generic parse failure with no real detail.
    const bodyText = await res.text();
    if (!res.ok) {
      // A 401 here means the cached token was rejected (revoked, or secrets
      // rotated). Drop it so the next request mints a fresh one instead of
      // failing identically until the instance recycles.
      if (res.status === 401) cachedToken = null;
      return json(
        { error: `IGDB responded with ${res.status} ${res.statusText} — ${bodyText.slice(0, 300)}` },
        res.status
      );
    }

    // IGDB returns a bare array; wrap it so success and error responses stay
    // structurally distinguishable for the client.
    const results = JSON.parse(bodyText);
    return json({ results });
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
