# Future ideas

A running backlog of features discussed but not yet built. Add to this as new ideas come up in conversation, so they don't only live in chat history.

## Social & sharing

- ~~**Share a review to Instagram Stories.**~~ **Built** (`js/sharecard.js`). Generates a 1080×1920 PNG from the poster, title, stars and notes, then hands it to the OS share sheet via `navigator.share({ files })`, falling back to a download where file sharing isn't supported. Because poster hosts don't reliably send CORS headers (TMDb's are inconsistent), a refused poster falls back to a typographic card built on the media type's color and emoji rather than failing.
  - *Possible follow-ups:* a preview step before sharing; a Supabase image proxy so posters always make it onto the card, if the fallback turns out to fire often.

## Personalization

*(Yearly goals were listed here and are now built — `goals` table, the goal
carousel, and custom multi-type goals.)*

## Social platform (bigger effort — prerequisite for the two below)

Discussed conceptually (see README/session history for the fuller breakdown): profiles (username/display name/avatar), friends/follows, a feed, and privacy controls on top of the existing per-user RLS model.

- **Tag a friend in a review** (mention).
- **Watch together.** A shared item where progress updates (e.g. marking an episode watched) apply to both people's journals at once.

## TV & progress tracking

- **Record TV completion per season, not per show.** Today a show is one item that goes to the Journal once, so there's no way to rate season 2 differently from season 4. Instead, finishing a season should create its own Journal entry for that season — with its own rating, notes and watched date — while the show itself carries on as a container.

  **Decided so far:**
  - **Seasons are the only things that reach the Journal.** The show is a container living in Currently Watching or Backlog; it never carries a rating of its own.
  - **The user is asked what happens to the show** each time a season is finished, with three outcomes: keep it in Currently Watching (the next season is already out), move it to Backlog (a next season exists but hasn't aired), or mark the series finished (there is no next season).
  - **The likely outcome is pre-selected, but all three stay one tap away.** TMDb's season list and series status usually make the right answer obvious, so the prompt should arrive with it already chosen — a confirmation rather than a cold question. It must never auto-apply or hide the alternatives: TMDb is regularly stale on unannounced renewals and wrong about which series have genuinely ended, and the user knows things it doesn't (dropping a show mid-run, say). The pre-selection is a shortcut for the common case, not a decision made on the user's behalf.
  - **Existing completed shows stay as they are** — legacy show-level entries. There's no way to know which seasons an old entry actually covered, so nothing gets migrated or invented.
  - **Seasons become the unit everywhere**, not just the Account page: the pie, the activity calendar, the total, and yearly goals all count completed seasons, so no two screens disagree about what a "completed TV thing" is.

  **Open question — what "series finished" means.** These two decisions pull against each other: seasons-only says the show never lands in the Journal, but `status: 'completed'` is currently exactly what puts an item *in* the Journal (`renderJournal()`, and `accountStatsForYear()` counts it). So "mark the series finished" needs a home that is neither Currently Watching, Backlog, nor a rated Journal entry. Either a fourth status (a schema change to the `status` CHECK constraint in `supabase/schema.sql`), or keep `completed` but exclude TV *containers* from Journal rendering and from every stat — leaving the mildly odd notion of a completed item that never appears in the Journal. Settle this first; most of the rest follows from it.

  **Existing machinery this has to reconcile with:**
  - `checkForNewTvSeasons()` (`js/app.js`) already does a season-aware cycle: a completed show that gains a new season on TMDb returns to Backlog tagged **🆕 New Season**, pre-positioned at episode 1. That overlaps directly with the "move to Backlog until the next season airs" outcome — the two should become one mechanism, not two that both move shows around.
  - The `🆕 New Season` / `Dropped` tags (`TV_ONLY_BACKLOG_TAGS`) and their lifecycle hang off that same cycle.
  - `progress_season` / `progress_episode` stay the live pointer on the container; a season entry is what gets *emitted* when the pointer rolls over.
  - **Season entries need distinct `external_id`s** (something like `tv-1399-s2`), or `matchesLibraryItem()` in `js/importexport.js` will treat every season of a show as the same item and dedupe them into one.
  - **Season numbers aren't always TMDb's raw seasons.** `getTVSeasonInfo()` prefers a named episode *group* for anime where that's a better breakdown, so season entries must record which numbering they came from or they'll disagree with the show as TMDb data shifts.
  - Counting changes land in `accountStatsForYear()`, `completedCountForYearTypes()`, the activity calendar's `completionsByDayForMonth()`, and the pie — all of which currently filter on `status === 'completed'` per item.

## Search

- **Predictive/autocomplete-as-you-type.** A debounced preview search (small page size) shown in a suggestions dropdown as the user types, separate from the full search-on-submit flow that exists today.

## Import / data sources

- **Serializd import**, if/when they ship a reliable free export (none exists today).
- **Anime-specific season data source** (e.g. AniList or Jikan/MyAnimeList) as a fallback for anime titles where TMDb's own season data is incomplete or misnumbered, beyond what the existing TMDb-episode-groups fix already covers.
