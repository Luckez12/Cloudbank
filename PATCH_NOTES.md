Cloudbank 1.20.73 — VidRock 3.1.0 repeated-search speed update

One combined patch: provider, manifest, exact delete list and regression tests. No YML, dependency, VUEO app or deletion-script change. Subtitle behavior is unchanged from v3.0.0; both the complete subtitle implementation and its standalone test are byte-identical. The media verification function is also byte-identical.

What changes
The previous rendition cache required the full master URL to match. A fresh API URL with a changed hostname/folder/token could not use that entry. v3.1.0 remembers only the relative rendition path, master filename, quality and codec metadata learned from a successfully validated master. That choice is scoped to the exact requested TMDB movie/TV/season/episode and the logical API server for 60 seconds. It is resolved against the CURRENT authenticated API URL each time. No previous hostname or folder token is copied, and there is no hardcoded 1080p/CDN/movie route.

Cache eligibility remains limited to HTTPS same-origin/same-directory m3u8 paths without credentials, query, fragment or separate audio group. The incoming master filename must match the learned filename. Opaque-token routes such as the previously inspected Luna routes are not eligible. Different movies, episodes and servers do not share choices.

Every cache hit still fetches the current child playlist and probes its segment. If the cached path fails, the entry is removed, its per-invocation child read is invalidated, and the current master is fetched normally. TTL does not extend just because a cache hit succeeds. Completed alternatives, quality/audio rules, HLS MIME/headers, source limit, parallelism and total deadline are retained.

Expected limits
This saves a master-playlist request on eligible repeated searches, including when URL tokens or hostnames rotate. It does not remove the necessary first-search requests or Luna's opaque-token hops. Total time still waits for the slower validated route; a faster Orion does not reduce total time below Luna's completion time. This is not a fixed-seconds speed guarantee. Existing app-memory cache support is used; no new app bridge or player change.

Validation
- npm run validate: 39 providers and matching manifest inventory.
- node --check providers/vidrock.js.
- node tests/vidrock-website.cjs: existing protocol/media checks, derived paths, current URL resolution, no copied old token/host, malformed path and filename rejection.
- node tests/vidrock-latency.cjs: fresh host/folder/token rotation, both sources retained, fresh child and segment probes, cache scope across titles/episodes, stale-HTTP and stale-segment repair, TTL, query exclusion and cleanup.
- node tests/vidrock-subtitles.cjs: unchanged test still passes.
- Controlled synthetic rotating-URL replay: v3.0.0 11477ms/two links; v3.1.0 8583ms/two links (25% faster). These are fixture measurements, not handset or live playback results. This patch has not been tested on the phone. The user confirmed v3.0.0 subtitle playback; that implementation is unchanged.

Apply and check
Apply this ZIP, run a fresh build, then search the same title twice within one minute. Inspect VARIANT_CACHE: recipe saved/hit and TIMING variantHits. The first run after a version update starts a new cache namespace. Share the second search log to measure actual improvement.
