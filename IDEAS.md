# Future ideas

A running backlog of features discussed but not yet built. Add to this as new ideas come up in conversation, so they don't only live in chat history.

## Social & sharing

- ~~**Share a review to Instagram Stories.**~~ **Done — shipped and confirmed working on a real device.** (`js/sharecard.js`.) Generates a 1080×1920 PNG from the poster, title, stars and notes, then hands it to the OS share sheet via `navigator.share({ files })`, falling back to a download where file sharing isn't supported. Because poster hosts don't reliably send CORS headers (TMDb's are inconsistent), a refused poster falls back to a typographic card built on the media type's color and emoji rather than failing.
  - *Possible refinements, not blocking:* a preview step before sharing; a Supabase image proxy so posters always make it onto the card, if the fallback turns out to fire often in practice.

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

  **Resolved — "series finished" is a fourth status, `'ended'`.** The open
  question here was whether to add a status or keep `completed` and exclude
  containers everywhere. Settled in favour of the fourth status: `status =
  'completed'` is tested in **13 separate places** in `js/app.js` (Journal
  rendering, four stat functions, Clean Up, the tag list, Discover's
  already-seen badge, the edit modal), and a container that is never
  `completed` drops out of all of them for free. The alternative meant
  hand-adding a "...unless it's a TV container" clause to each, where
  missing one gives a silently wrong count with nothing failing loudly.

  The invariant to hold onto: **a TV container is never `'completed'`.**

  **Also decided: a finished show is visible only through its season
  entries.** It leaves Backlog and Currently Watching and gets no view of
  its own — the Journal already holds one entry per season watched, which
  is the actual record.

  **Schema is done and verified** (`supabase/one-off/add-season-entries.sql`,
  plus `supabase/schema.sql` for fresh projects): the `status` CHECK now
  allows `'ended'`, and a nullable `season_number` marks a row as recording
  one season. NULL means "not a season entry" — every non-TV item, every
  container, and every legacy show-level TV row.

  **Existing machinery this has to reconcile with:**
  - `checkForNewTvSeasons()` (`js/app.js`) already does a season-aware cycle: a completed show that gains a new season on TMDb returns to Backlog tagged **🆕 New Season**, pre-positioned at episode 1. That overlaps directly with the "move to Backlog until the next season airs" outcome — the two should become one mechanism, not two that both move shows around.
  - The `🆕 New Season` / `Dropped` tags (`TV_ONLY_BACKLOG_TAGS`) and their lifecycle hang off that same cycle.
  - `progress_season` / `progress_episode` stay the live pointer on the container; a season entry is what gets *emitted* when the pointer rolls over.
  - **Season entries need distinct `external_id`s** (something like `tv-1399-s2`), or `matchesLibraryItem()` in `js/importexport.js` will treat every season of a show as the same item and dedupe them into one.
  - **Season numbers aren't always TMDb's raw seasons.** `getTVSeasonInfo()` prefers a named episode *group* for anime where that's a better breakdown, so season entries must record which numbering they came from or they'll disagree with the show as TMDb data shifts.
  - Counting changes land in `accountStatsForYear()`, `completedCountForYearTypes()`, the activity calendar's `activityByDayForMonth()`, and the pie — all of which currently filter on `status === 'completed'` per item.

- ~~**Show progress days on the activity calendar.**~~ **Done.** Days you moved a book, show or game along now draw a hollow dot in the type's colour beside the filled dots for things finished, with a key under the grid. A type finished on a day suppresses its own outline, so one event never draws two dots.
  - Needed new data: nothing recorded *when* progress happened — `progress_percent`/`progress_season`/`progress_episode` hold only the current value, and `updated_at` is overwritten by any edit at all. Added `progress_days text[]`, one local `'YYYY-MM-DD'` per day, written through `withProgressDay()` in `js/app.js`.
  - Only user-initiated progress counts. `checkForNewTvSeasons()` writes `progress_season` directly on purpose — the app noticing a season dropped isn't an evening spent watching.
  - **No history before it shipped**, and none can be reconstructed. `supabase/one-off/add-progress-days.sql` has an optional, clearly-labelled seed for currently in-progress items based on `updated_at`, which is a guess rather than a recovery.

## Search

- **Predictive/autocomplete-as-you-type.** A debounced preview search (small page size) shown in a suggestions dropdown as the user types, separate from the full search-on-submit flow that exists today.

## Import / data sources

- **Obsidian vault export** — scoped in detail, then paused. A `.zip` from the Import/Export modal that unzips into a droppable Obsidian vault: one markdown note per item (folder per type, full YAML frontmatter, poster embed, your review above the third-party synopsis), an index note, a README explaining provenance, and the raw JSON backup alongside. Reuses the JSZip already loaded for the Letterboxd import.
  - **The part that matters is the restore, not the export.** Pair it with a JSON importer ("Restore from a Media Journal backup") and widen `exportAsJson()` to carry goals and the Libby code, and Supabase stops being a single point of failure. Without that, it's an archive you can read but not reload.
  - Gotchas found while scoping: use a `journal_tags` frontmatter key, not `tags` — Obsidian mangles tags containing emoji and spaces, and all of `BACKLOG_TAGS` do. Keep reviews and descriptions in the note body so no multi-line YAML escaping can eat them. Sanitize filenames for `/ \ : * ? " < > |` and `# ^ [ ]`, and de-duplicate collisions.
  - Posters degrade rather than fail: fetching image bytes needs cross-origin `fetch()`, and TMDb's image CORS is inconsistent (the same thing that forced the share card's fallback). Embed what succeeds, keep the remote URL for what doesn't, and report the count honestly.
  - **Context on why this was scoped:** the worry was the app breaking because of "the number of APIs". The five APIs are capture-time only — search, posters, episode counts — and the library renders fine without any of them. The actually load-bearing dependencies are Supabase (this export's job), GitHub Pages (static files, re-hostable anywhere), and the three jsDelivr `<script>` tags in `index.html`, which are the one that would stop the app booting. **Vendoring those three into `js/vendor/` is the other half of the durability story and is a much smaller job.**
- **Serializd import**, if/when they ship a reliable free export (none exists today).
- **Anime-specific season data source** (e.g. AniList or Jikan/MyAnimeList) as a fallback for anime titles where TMDb's own season data is incomplete or misnumbered, beyond what the existing TMDb-episode-groups fix already covers.
