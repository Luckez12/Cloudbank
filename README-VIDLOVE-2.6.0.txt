Cloudbank — VidLove v2.6.0 (parallel subtitles without holding video)
Repository version 1.20.95

INSTALL
Upload manifest.json, providers/ and tests/ to the Cloudbank repository root and replace matching files. Refresh Cloudbank in VUEO, then confirm VidLove shows 2.6.0. No VUEO app patch, no file deletions and no YML changes.

BEHAVIOR
Video engines start as before (up to 3 concurrent engine requests). One subtitle-list request for the exact movie or TV episode starts alongside them, using the same API request headers and overall provider deadline. No separate short subtitle timeout.
When the first eligible video is ready (native or existing website fallback), snapshot and merge its payload subtitles with subtitle-list tracks that have already finished parsing. Return the video immediately; there is no await for subtitles at that point. No eligible video cancels subtitle work and returns no result.
Pending subtitle work is aborted through AbortController where the host exposes it. VUEO versions without that API cancel remaining native requests when the provider execution finishes; late promise results are ignored and cannot change the returned streams. Completed subtitle requests need no cancellation.
Only English and Malay tracks are kept from either payload or endpoint. Common en/eng/en-* and ms/msa/may/ms-* codes and English/Malay/Melayu labels are recognized. Other/unknown languages are excluded rather than guessed from file URLs. Existing names are preserved; language codes are normalized to en/ms. The server endpoint may still send all languages; filtering happens locally and does not claim to reduce the endpoint's network time.

TRADEOFF
If video is found before the subtitle list has finished parsing, those late subtitles are omitted for that scan. This is intentional to prevent subtitles delaying the video link. There is no deferred subtitleRequests field or dependency on the removed VUEO provider-overlay/first-frame discovery patches. Subtitles use the pre-existing normal provider result format.
Video URL/header selection, original-audio rules, known qualities >=720p (Auto/unknown allowed), and early website fallback behavior are retained. No title-specific IDs or signed media links are hardcoded.

VALIDATION
node tests/vidlove-parallel-subtitles.cjs: 11 deterministic no-wait/cancellation/language/TV/late-JSON/merge checks passed.
node tests/vidlove-current.cjs: actual VUEO URL shim, engine fallback, media/header preservation, subtitle and rejection regressions passed.
node tests/vidlove-browser-fallback.cjs: 18 checks passed.
node tests/vidlove-website.cjs: 12 checks passed.
npm run validate: all 36 providers validated.
Tests use mocked HTTP/website responses. Real-device playback and server response timing still require testing.
