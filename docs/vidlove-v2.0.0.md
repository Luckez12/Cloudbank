# VidLove v2.0.0 — current website API, one engine

Apply this patch at the Cloudbank repository root, overwrite matching files, follow DELETE_FILES.md and refresh the provider. No app patch or workflow files are included.

## Resulting flow

The current player.vidlove.cc frontend names api.vidlove.cc as its API and includes VidAPI among its active source engines. The legacy provider used another host, requested ten source engines concurrently, required 1080p and added hevc=1 unconditionally.

The replacement performs one exact movie/TV episode request to the current API with sources=vidapi. It does not request a browser/service-worker output mode or force HEVC. It returns the API's original media URL byte-for-byte. An inline #EXTM3U manifest identifies opaque signed HLS URLs such as /api?... correctly; the provider does not return inline text or manufacture a playlist URL. The existing remote master remains the playback URL.

No master, child, segment, metadata or subtitle network requests are made by production discovery. Adaptive masters return Auto without rendition filtering. Known direct files below 720p are rejected. Unknown audio is accepted; explicit dub-only or explicitly listed audio languages excluding the known original language are rejected. TMDB language is not asserted to be stream audio evidence. Existing API-supplied media headers are preserved; fallback Referer/Origin match the player origin used in the successful audit.

There is no fan-out, retry, source-order fetch, speculative fallback or signed media cache. If the chosen engine has no source, the provider returns an empty result. One source engine does not promise coverage of all the other website engines.

## Evidence and limits

On 2026-10-23 the actual player page and its current JavaScript were inspected. A movie request to the VidAPI route returned HTTP 200 with matching TMDB metadata, a signed HLS URL and a master manifest. A separate development audit of that URL returned HTTP 200 application/vnd.apple.mpegurl with three variants. The audit master fetch is not part of production discovery.

Other sampled website engines returned empty sources for that movie. The sampled TV episode also returned an empty source on VidAPI; TV coverage and playback are not confirmed. No physical Android playback test was performed. API/root-master success is not a guarantee of subsequent playback, segments or device performance.

Tests cover the exact movie/episode query, one network call, actual VUEO URL compatibility shim, byte-preserved opaque signed master, headers, audio evidence, adaptive/direct quality handling, empty/error responses and mismatched identities. The existing VUEO URL shim keeps URL.searchParams separate from href, so the API query is built explicitly and the captured media URL is never reserialized.

`node tests/vidlove-current.cjs` and `npm run validate` pass. Manifest: 1.20.86, VidLove: 2.0.0, 36 providers. Existing confirmed VixSrc/VidFast versions remain in the manifest.
