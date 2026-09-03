// The handful of item predicates that more than one module needs.
//
// These live here rather than in js/app.js so exports (js/sequelexport.js,
// and anything else that has to reason about the shape of a TV row) can
// share them instead of re-deriving the same regex. app.js re-exports
// nothing — it imports from here like everyone else.

// A TV show is a *container* that lives in Backlog or Currently Watching
// and never reaches the Journal itself. Finishing a season emits its own
// completed row, so season 2 can be rated differently from season 4.
//
// season_number is what distinguishes the two. NULL means "not a season
// entry": every non-TV item, every container, and every legacy show-level
// TV row from before this existed.
export function isSeasonEntry(item) {
  return item.media_type === 'tv' && item.season_number != null;
}

// Groups season entries belonging to the same show. Prefers the TMDb id
// embedded in external_id ('tv-95396-s2' -> 'tv-95396') since titles can be
// edited or duplicated; falls back to the title for manually-added shows
// that never had one.
export function showKey(item) {
  if (item.media_type !== 'tv') return null;
  const match = /^(tv-\d+)(?:-s\d+)?$/.exec(item.external_id || '');
  return match ? match[1] : `title:${(item.title || '').trim().toLowerCase()}`;
}
