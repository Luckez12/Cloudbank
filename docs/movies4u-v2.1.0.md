# Movies4u v2.1.0 / Cloudbank v1.20.67

Overwrite manifest.json and providers/movies4u.js, upload and refresh the repository in VUEO. No YML or deletion scripts. All seven previous provider removals, including MoviesHunt, remain absent from the manifest; do not restore those files.

## Speed changes

The identity check now selects only IMDb anchors before validating the URL/identifier instead of reading every anchor on the post. Reuse the already parsed, verified post document for quality parsing. Skip unsupported host anchors before computing their block labels. Cold discovery still verifies IMDb/title and exact episodes.

Use the existing generic vueoMetadataCache API when installed: active domain and verified post routes are cached in app memory for up to five minutes; published file routes for two minutes. The cache is scoped to the app's repository/provider version plus current site, TMDB identity revision, original audio language, season and episode. No cross-episode reuse is permitted. Invalid entries are ignored; no-media outcomes clear routes for fresh discovery on the following scan. No negative-result cache.

Cache only small parsed public route descriptors. Never cache generated host tokens, signed video URLs, playlists, subtitle configuration, full HTML or media bytes. Every scan still opens the host, obtains current generated URLs and range-validates the returned video.

Check CACHE_SCOPE in the log: app-memory means the existing native bridge is active across disposable provider runtimes. It was included in the earlier VUEO catalogue-cache and AnimePahe browser-access app patches. runtime-only means the app lacks that bridge; normal verified discovery and parser improvements still work, but cache does not survive a fresh runtime. Phase 20 decoder changes do not overwrite that generic bridge or hardcode Movies4u in VUEO.

## Validation

21 website/identity/episode/media checks plus 13 cache checks passed (34 total). Cache tests use fresh VM instances with a simulated native cache and verify expiry, identity/language/episode isolation, fresh signed tokens, fresh probes, corrupted entries, failure invalidation and behavior without the bridge. Repository validation passed with 41 providers.

Replay of actual saved website HTML, with a 20ms simulated delay per HTTP operation, retained three sources:

| Metric | v2.0.2 | v2.1.0 cold | v2.1.0 cached |
|---|---:|---:|---:|
| HTTP calls | 13 | 13 | 9 |
| DOM operations | 520 | 157 | 33 |
| Attribute reads | 192 | 24 | 6 |
| HTML parses | 9 | 8 | 6 |
| Observed replay time | 251ms | 181ms | 66ms |

These are controlled replay measurements, not device/network speed promises. First-time discovery still follows the website dependency chain. Actual phone timing and playback need testing. 4K and the existing audio/codec policies remain available.
