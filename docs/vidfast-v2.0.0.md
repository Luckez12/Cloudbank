# VidFast v2.0.0 — current website session resolver

Apply at the Cloudbank repository root and refresh the provider. Follow DELETE_FILES.md for the existing removal list. No app source files or workflows are included.

## Change

The old resolver searched one escaped HTML token pattern, delegated decoding to an external API and fetched the master again to generate resolution-specific links. The current site returns a Next.js player and handles its routing/decoding in its own client code.

The replacement opens one exact `/movie/{tmdb}/` or `/tv/{tmdb}/{season}/{episode}/` website session through the existing browser bridge. The website runs its own JavaScript. The resolver accepts browser-captured HLS/DASH or direct MP4 media and preserves the original URL byte-for-byte, including its signature and query. Playback headers and cookies supplied by the bridge are retained, excluding transport/Range headers. Explicit dub-only metadata is rejected; unknown audio is accepted.

The session finishes 100 ms after the first media candidate, within a 12-second timeout. It schedules no coordinate clicks. There are no separate provider HTTP requests, external decrypt calls, token replays, metadata/subtitle requests, master/child/segment probes, resolution splitting or signed URL caches. Adaptive masters are returned as Auto without filtering their renditions.

## Verification and limits

- Current public player HTML and JavaScript were inspected. This confirms client-owned stream setup, not successful playback.
- The cloud test browser remained on `FETCHING, ONE MOMENT...` for both the reported movie and the title shown playing in the user's screenshot, including one reload. No live media URL or playback was verified in that environment. This does not establish that the user's browser or Android WebView will fail.
- Regression fixtures pass for exact movie/episode routes, one browser session, basic/detailed bridge outputs, invalid candidate rejection, signature/header preservation and no native HTTP/decoder/playlist/subtitle fetches.
- URL preservation is also tested with the actual VUEO URL/URLSearchParams compatibility layer extracted from PluginRuntime.kt. The host URL parser is simulated with Node URL; these are code tests, not Android browser tests.
- `npm run validate` passes with 36 providers, manifest v1.20.85 and VidFast v2.0.0.

Device discovery, search timing and playback require testing. A source URL capture alone is not proof that playback works. If a device test returns no sources, use its session result before selecting another implementation; do not infer that the website is dead from a single empty session.

Tests: `node tests/vidfast-session.cjs` and `npm run validate`.
