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
//
// Deploy with the Supabase CLI (see README's "Setting up video game
// search (RAWG)" section):
//   supabase functions deploy rawg-search
//   supabase secrets set RAWG_API_KEY=<your RAWG key>

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const RAWG_API_KEY = Deno.env.get('RAWG_API_KEY');
  if (!RAWG_API_KEY) return json({ error: 'RAWG_API_KEY is not set — run: supabase secrets set RAWG_API_KEY=<key>' }, 500);

  try {
    const { query } = await req.json();
    if (!query || typeof query !== 'string') return json({ error: 'Missing "query" in request body.' }, 400);

    const res = await fetch(
      `https://api.rawg.io/api/games?key=${encodeURIComponent(RAWG_API_KEY)}&search=${encodeURIComponent(query)}&page_size=20`
    );
    const data = await res.json();
    if (!res.ok) {
      const detail = data && data.detail ? ` — ${data.detail}` : '';
      return json({ error: `RAWG search failed (${res.status})${detail}` }, res.status);
    }
    return json(data);
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
