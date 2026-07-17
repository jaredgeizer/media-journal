// Syncs a user's public Steam wishlist into their Backlog (media_type
// 'game', status 'wishlist', external_source 'steam'). Runs server-side
// specifically to get around Steam's wishlist endpoint not sending CORS
// headers — a direct browser fetch() (the way js/search.js calls
// TMDb/RAWG/etc.) is blocked, so this has to sit in front of it.
//
// Two invocation modes, distinguished by which header is present:
//
//   1. User-invoked — `Authorization: Bearer <user JWT>`, from the app's
//      "Sync Now" button (js/storage.js's syncSteamWishlist(), via
//      supabase.functions.invoke() which attaches the JWT automatically).
//      Looks up *that one* user's Steam ID (RLS-scoped, no elevated
//      privileges needed) and returns their wishlist mapped to
//      item-shaped objects — it does NOT write to the database. The
//      client reuses the existing dedupeAgainstLibrary()/
//      openImportPreviewModal() review-then-confirm flow (the same one
//      Goodreads/Fable/Letterboxd imports already use) to add them.
//
//   2. Cron-invoked — `x-cron-secret: <CRON_SECRET>` matching the
//      CRON_SECRET secret (see README's Steam sync setup section),
//      from the scheduled GitHub Actions workflow
//      (.github/workflows/sync-steam-wishlist.yml). Loops every row in
//      steam_accounts using the service role key (auto-injected, bypasses
//      RLS — needed since this runs with no user session) and inserts
//      any new games directly. This is the path that makes sync actually
//      automatic with no action required from the user.
//
// NOTE: this uses the unofficial
// store.steampowered.com/wishlist/profiles/<id>/wishlistdata/ endpoint
// rather than the documented IWishlistService REST API, because the
// documented one only returns appids (no name/image) and would need a
// second lookup per game. Valve doesn't document wishlistdata or
// guarantee its shape/availability — if Steam changes or removes it,
// fetchWishlist()/mapEntry() below are where to fix it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function steamPosterUrl(appid: string) {
  // Predictable Steam CDN path — no extra request needed to get artwork.
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
}

function steamStoreUrl(appid: string) {
  return `https://store.steampowered.com/app/${appid}`;
}

type ExistingItem = { external_source: string | null; external_id: string | null; title: string; media_type: string };
type WishlistEntry = { appid: string; name: string | null };

// Mirrors js/importexport.js's matchesLibraryItem(): trust a same-source
// external id first, otherwise fall back to a case-insensitive title
// match within the same media type (catches a game already added by hand
// or via the RAWG search before it was ever wishlisted on Steam).
function alreadyHasGame(existingItems: ExistingItem[], appid: string, name: string | null) {
  const idMatch = existingItems.some((i) => i.external_source === 'steam' && i.external_id === String(appid));
  if (idMatch) return true;
  const titleNorm = (name || '').trim().toLowerCase();
  if (!titleNorm) return false;
  return existingItems.some((i) => i.media_type === 'game' && i.title.trim().toLowerCase() === titleNorm);
}

// wishlistdata is paginated (roughly 1000 entries per page, historically)
// — keep requesting pages until one comes back empty. Capped generously
// so a malformed/unexpected response shape can't spin this forever.
async function fetchWishlist(steamId: string): Promise<WishlistEntry[]> {
  const entries: WishlistEntry[] = [];
  for (let page = 0; page < 20; page++) {
    const res = await fetch(
      `https://store.steampowered.com/wishlist/profiles/${encodeURIComponent(steamId)}/wishlistdata/?p=${page}`
    );
    if (!res.ok) {
      throw new Error(`Steam responded with ${res.status} — check your Steam ID and that your wishlist is public.`);
    }
    const data = await res.json();
    const pageEntries = Array.isArray(data) ? [] : Object.entries(data || {});
    if (!pageEntries.length) break;
    for (const [appid, entry] of pageEntries as [string, { name?: string }][]) {
      entries.push({ appid, name: entry && entry.name ? entry.name : null });
    }
  }
  return entries;
}

function mapEntry(appid: string, name: string | null) {
  return {
    media_type: 'game',
    title: name || `Steam App ${appid}`,
    creator: null,
    year: null,
    poster_url: steamPosterUrl(appid),
    description: null,
    external_source: 'steam',
    external_id: String(appid),
    external_url: steamStoreUrl(appid),
    status: 'wishlist',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const CRON_SECRET = Deno.env.get('CRON_SECRET');

  const cronSecretHeader = req.headers.get('x-cron-secret');

  try {
    if (CRON_SECRET && cronSecretHeader === CRON_SECRET) {
      // ---- Scheduled sync: every connected user, service role ----
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: accounts, error: acctErr } = await admin.from('steam_accounts').select('user_id, steam_id');
      if (acctErr) throw acctErr;

      const results = [];
      for (const account of accounts || []) {
        try {
          const wishlist = await fetchWishlist(account.steam_id);
          const { data: existingItems, error: itemsErr } = await admin
            .from('items')
            .select('external_source, external_id, title, media_type')
            .eq('user_id', account.user_id);
          if (itemsErr) throw itemsErr;

          const toInsert = wishlist
            .filter((entry) => !alreadyHasGame((existingItems as ExistingItem[]) || [], entry.appid, entry.name))
            .map((entry) => ({ ...mapEntry(entry.appid, entry.name), user_id: account.user_id }));

          if (toInsert.length) {
            const { error: insertErr } = await admin.from('items').insert(toInsert);
            if (insertErr) throw insertErr;
          }
          await admin
            .from('steam_accounts')
            .update({ last_synced_at: new Date().toISOString() })
            .eq('user_id', account.user_id);
          results.push({ user_id: account.user_id, added: toInsert.length });
        } catch (err) {
          results.push({ user_id: account.user_id, error: String((err as Error)?.message || err) });
        }
      }
      return json({ synced: results.length, results });
    }

    // ---- User-invoked: just this caller, no DB write ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'Not authenticated.' }, 401);

    const { data: account, error: acctErr } = await userClient
      .from('steam_accounts')
      .select('steam_id')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (acctErr) throw acctErr;
    if (!account) return json({ error: 'Connect your Steam ID first (Import / Export → Steam Wishlist).' }, 400);

    const wishlist = await fetchWishlist(account.steam_id);
    const mapped = wishlist.map((entry) => mapEntry(entry.appid, entry.name));
    return json({ items: mapped });
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
