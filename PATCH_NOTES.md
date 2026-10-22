Cloudbank 1.20.72 — VidRock 3.0.0

One combined ZIP: provider, manifest, DELETE_FILES.md and three standalone regression tests. No VUEO application files, dependencies, YML or executable deletion script. Apply using the existing patch workflow. NetMirror and Peachify must remain absent; if already deleted, no further deletion is needed.

Discovery and source changes
- Removes the 1500ms post-first-source cutoff. Continues eligible routes in parallel, retaining up to three validated sources, subject to per-request timeouts and the existing 17.5s total budget. A slow/unavailable host can still yield fewer sources. Already completed sources survive the total deadline.
- Bundles the public AES-GCM protocol key from the current website bundle /assets/index-BWWyXXb7.js. Its compatibility with the current movie API was checked with authenticated decryption. The normal cold path skips homepage and 1.27MB bundle requests. If all eligible encrypted URLs fail authentication with this bootstrap/cached key, fetch the current website key once and retry decoding. No static movie/title/device exception or VUEO hardcode is introduced.
- Keeps the existing public-key metadata cache, 5-minute TTL and optional app-memory bridge. A cache miss after a provider-version update or process restart is normal. The bootstrap path does not require a warm cache. Diagnostics distinguish website-bootstrap, cache hit and refreshed key.
- Collapses duplicate decrypted source URLs and shares identical in-flight reads. Small HLS/JSON reads may be reused within one invocation; media validation is retained.
- Reuses a previously validated rendition choice for 60s only for exact same root URL, same-origin/same-directory .m3u8 paths without credentials/query/fragment or audio group. Each use still fetches the child playlist and checks its segment. A stale/failed cached route is discarded and the master fetched again. Opaque token routes are not eligible. No video payload is cached. App cache is process-local; provider-local fallback lasts only for that JS runtime.
- Preserves explicit HLS MIME, headers, 720p minimum, audio label policy, PNG/HTML rejection, native text-prefix limitations and binary/SPS checks where available.

Website subtitles
- Fetches the website v1 subtitle list concurrently with media discovery; v2 is a fallback. Subtitle requests do not add a post-media wait. A list which is not ready when media completes may be omitted; embedded captions and app subtitle features are separate.
- Supports website array, wrapper and language-map JSON shapes, HTTPS sidecars, VTT/SRT/ASS MIME and request headers. Groups different languages before duplicate tracks within the app's 32-track limit, preferring unnumbered tracks. The inspected 66-entry website list includes English and Malay within the resulting 32-track selection. This does not synthesize or translate subtitles.
- Public no-query subtitle-list metadata may be reused for 60s. Subtitle content/synchronization is not presumed from a language label. A live English VTT file was HTTP200 with a WEBVTT prefix; synchronization with playback needs device testing.

Validation and practical limits
- npm run validate: 39 providers, manifest/file inventory matched.
- node --check providers/vidrock.js.
- node tests/vidrock-website.cjs: GCM authentication/tamper, bundled-key mismatch refresh, cached-key rotation, exact routing, HLS MIME, relative redirects, native fallback, quality/audio rules and bad-payload rejection.
- node tests/vidrock-latency.cjs: disposable-runtime cache reuse, master skip with fresh child/segment probes, expiry/stale fallback, query exclusion, subtitle parallelism/fallback/cache, deduplication, full deadline and late-work/timer cleanup.
- node tests/vidrock-subtitles.cjs: subtitle shapes, MIME, language variety, URL/track bounds and cache scope.
- Controlled replay of a synthetic schedule based on the earlier device log: v2.1.0 cold 8132ms/one link; v3.0.0 cold 11477ms/two links; v3.0.0 warm 8583ms/two links. The uncapped v2.0.0 replay previously took 13077ms/two links. Preserving the second source can be slower than dropping it. These are fixture results, not handset speed measurements or guarantees. Cache benefit depends on source URL shape; Luna's opaque routes do not qualify for master reuse.
- Live checks during this update: current website/API/key inspected; the requested movie API returned one URL (Luna), not two. The provider retrieved 32 subtitle entries via v1. The video host timed out in the full live provider run, yielding zero validated video sources in that run. Playback of this update is not confirmed. The previous v2.1.0 device log did show video playback. Do not interpret API/playlist/subtitle checks as full playback or subtitle synchronization confirmation.

Test on device
Apply this combined patch, run a fresh build, search the same movie twice within one minute, and test playback plus English/Malay subtitles. Share the full provider/player log. Inspect DISCOVERY, VARIANT_CACHE, TIMING and SUBTITLE_RESULT. Source count follows the current website API and completed host checks.
