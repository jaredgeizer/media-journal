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

## Search

- **Predictive/autocomplete-as-you-type.** A debounced preview search (small page size) shown in a suggestions dropdown as the user types, separate from the full search-on-submit flow that exists today.

## Import / data sources

- **Serializd import**, if/when they ship a reliable free export (none exists today).
- **Anime-specific season data source** (e.g. AniList or Jikan/MyAnimeList) as a fallback for anime titles where TMDb's own season data is incomplete or misnumbered, beyond what the existing TMDb-episode-groups fix already covers.
