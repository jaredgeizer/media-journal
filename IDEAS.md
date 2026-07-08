# Future ideas

A running backlog of features discussed but not yet built. Add to this as new ideas come up in conversation, so they don't only live in chat history.

## Social & sharing

- **Share a review to Instagram Stories.** Generate a share-card image client-side (`<canvas>`, sized for Stories — 1080×1920) from the item's poster, title, star rating, and the user's notes. Instagram has no public API for posting directly, so the only reliable path is generating the image and handing it off via the Web Share API's file support (`navigator.share({ files: [...] })`), which lets the user pick Instagram from their OS share sheet themselves. Needs a fallback (plain image download) for browsers without `navigator.share` file support.

## Personalization

- **Yearly goals.** Let a user set one or more goals per year — e.g. "20 books", "5 movies", "2 shows" — and see progress toward each. Needs a `goals` table (type, target count, media type or combination, year) and a progress calculation over existing completed `items` within that year. Probably wants its own section of the app (or a fuller profile page) to display progress bars/counts.

## Social platform (bigger effort — prerequisite for the two below)

Discussed conceptually (see README/session history for the fuller breakdown): profiles (username/display name/avatar), friends/follows, a feed, and privacy controls on top of the existing per-user RLS model.

- **Tag a friend in a review** (mention).
- **Watch together.** A shared item where progress updates (e.g. marking an episode watched) apply to both people's journals at once.

## Search

- **Predictive/autocomplete-as-you-type.** A debounced preview search (small page size) shown in a suggestions dropdown as the user types, separate from the full search-on-submit flow that exists today.

## Import / data sources

- **Serializd import**, if/when they ship a reliable free export (none exists today).
- **Anime-specific season data source** (e.g. AniList or Jikan/MyAnimeList) as a fallback for anime titles where TMDb's own season data is incomplete or misnumbered, beyond what the existing TMDb-episode-groups fix already covers.
