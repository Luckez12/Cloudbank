# VidZee 1.0.1 — original audio and measured resolution

Repository version: 1.20.24. Provider version: 1.0.1.

Audio changes:
- Acme language servers and v6 language servers are requested only in the TMDB original language. Vikings therefore requests English, not Hindi.
- If shared TMDB detail data omits original_language, a bounded TMDB title search is used; only the identical numeric TMDB ID can supply the language. No first-result/title-language guess is accepted.
- Explicit non-original language payloads are excluded before returning sources.
- Dcloud/TCloud/IPcloud default servers may report Auto. These remain available and are logged AUDIO_UNVERIFIED; their audio is not independently identified. If original-language metadata is unavailable, forced-language servers are skipped. This removes known dubbed-language sources without claiming unknown Auto audio is proven original.
- No app changes or subtitle filtering are part of this patch.

Resolution changes:
- RESOLUTION in a returned HLS master remains the first source of dimensions. Master URL and provider server order are preserved; variants are not expanded.
- For a media-only playlist with no resolution, optionally request bytes 0-65535 from its first segment or EXT-X-MAP initialization file. Read H.264/H.265 SPS or MP4 track-header dimensions. Each probe is limited to 1.8 seconds and requires remaining provider budget.
- A large full response when Range is ignored is refused before calling arrayBuffer. Missing binary support, rejected requests, encrypted playlists or missing codec headers leave quality Auto. There is no resolution guess from a URL, bitrate or provider name.
- RESULT diagnostics now account for dimensions measured from master/codec headers.

Validation:
- Actual live Vikings TMDB 44217 S1 E1 English URL: playlist HTTP 200; first header sample HTTP 206, 65536 bytes; measured codec size 1280x720. This validates that sampled English source at 720p, not every server or future release.
- Encoder-generated MPEG-TS H.264 1280x720, raw H.264 1920x1080, HEVC 1280x720 and fragmented MP4 3840x2160 dimensions parsed correctly.
- Regression tests passed: English original excludes Hindi requests; Japanese original excludes English forced sources; explicit Hindi payload rejected for English title; exact-ID metadata fallback; Range probe bounds; oversized full response is not read; encrypted playlists are skipped.
- Existing movie/TV routing, headers, subtitle identity/order and source-order tests passed. All 52 providers passed repository validation.

Android binary probe support and new audio-filter behavior still need VUEO testing. Already working playback URLs are not replaced. Some sources may still show Auto when metadata is unavailable. Live 4K remains unverified.

Apply ZIP at repository root. Updates manifest.json, providers/vidzee.js and regression tests; adds this note. No YAML/workflow modifications.
