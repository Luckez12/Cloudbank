# VidLove v2.1.0 — source fallback, visible identity and website subtitles

Apply at the Cloudbank repository root, overwrite the included files, follow DELETE_FILES.md and refresh the provider. No app source or workflow changes are required.

## Identity and sources

The ID was present in v2.0.0's actual query. VUEO's compactTraceUrl intentionally displays only scheme/host/path, so the timeline entry `/movie` did not prove a missing ID. This patch emits a separate API_REQUEST line containing only the public request identity and engine, for example `/movie?id=...&mode=json&sources=...`. TV requests explicitly include season and episode. Returned signed media URLs are never logged or reserialized.

The resolver no longer stops after an empty VidAPI response. It tries the five engines currently listed in the inspected website frontend: vidapi, dcloud, moviebox2, moviebox and tcloud. At most three requests run concurrently; empty/failed/ineligible routes permit the next engine to start. It stops launching routes on the first eligible source and does not wait for slower alternatives. Each route has a maximum six-second provider wait, within a fourteen-second overall discovery/subtitle budget. There are no repeated engine retries or ten-engine fan-out. Existing runtime cleanup cancels unresolved native work when the provider completes.

The API can return its own source/provider label, which is preserved; this is not content identity evidence. Any explicit metadata ID must still match the requested TMDB ID. Audio policy, HTTPS media checks and direct-file minimum quality remain. Adaptive masters are returned unchanged as Auto, without child or segment probes. No WebView or forced HEVC is added.

## Subtitles

Valid HTTPS tracks in the selected response's payload/source subtitles are attached first. If none exist, the resolver requests the website's exact `/subtitles/movie/{id}` or `/subtitles/tv/{id}/{season}/{episode}` endpoint after finding video. This optional request waits at most 2.5 seconds and stays within the overall budget. If it fails, times out or returns no tracks, the video source is still returned.

Track URLs are preserved, duplicates removed, labels/languages retained and VTT/SRT MIME types supplied. Unknown labels are not marked English. data/blob URLs, malformed tracks and thumbnail/chapter tracks are excluded; at most 32 tracks are forwarded. Subtitle text is not downloaded during discovery. No subtitle request is made when no eligible video exists.

## Validation and current limits

Regression tests use both Node URL and VUEO's actual URL compatibility JavaScript. They verify ID/episode query and log visibility, original signed URL/header preservation, fallback through the last engine, maximum concurrency, payload track reuse, website subtitle handoff, MIME/language/deduplication, invalid track rejection and subtitle failure isolation.

The actual subtitle endpoint for TMDB 1108427 returned HTTP 200 with one HTTPS English VTT track plus a data-URL easter egg; the latter is deliberately rejected. Its cold request took about fourteen seconds in the audit environment, longer than the optional production subtitle wait. Subtitle availability within that wait is therefore not guaranteed. No Android playback test was performed.

The recent API audits for TMDB 1108427 returned empty sources across all tested current engines; a previously successful control also returned empty. A fallback implementation cannot manufacture a source when the backend returns none. This patch corrects source coverage and subtitle wiring, not confirmed backend availability. Device testing remains necessary.

`node tests/vidlove-current.cjs` and `npm run validate` pass. Manifest v1.20.87 / VidLove v2.1.0, 36 providers. The existing delete list is included and VidLove is not added to it.
