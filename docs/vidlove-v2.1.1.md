# VidLove v2.1.1 — separate API and playback headers

Apply at the Cloudbank repository root and refresh the provider. The manifest and existing DELETE_FILES.md are included. No app patch or workflow changes are required.

## Reproduced difference

For the same exact TMDB 1108427 VidAPI URL, a browser-navigation-style request returned HTTP 200 with metadata, subtitles and a signed master. The v2.1.0 provider header profile returned HTTP 200 with source:null. Further controlled comparisons kept the URL, Android User-Agent and application/json Accept identical:

- Referer without Origin: HTTP 200, source present, cache HIT.
- Origin without Referer: HTTP 200, source:null, cache BYPASS.
- Changing only User-Agent or Accept did not explain the difference.

This demonstrates the current request-profile difference in the audit environment. It is not proof that the API always behaves this way on every network. Earlier empty API audits used the provider's Origin header, so they could not establish that the movie was unavailable.

## Fix

Remove Origin from native API request headers only, including the optional API subtitle endpoint. Keep Referer, User-Agent and JSON Accept. The media playback headers are created separately and keep their existing Origin/Referer. The signed media URL is unchanged byte-for-byte. Existing bounded source fallback, subtitle handoff and original/dual/unknown audio handling are retained.

No retry loop, WebView, media/master/child/segment fetch, app code, title-specific rule or request-ID workaround is added. ID was already present in the query; compact application logs continue to redact or hide query values as before.

## Validation

The existing regression suite now also rejects Origin on API requests and verifies Origin remains on playback requests. A captured successful real API payload was replayed through the production provider with the actual VUEO URL compatibility JavaScript: one signed source and one HTTPS subtitle were returned, with no data-URL easter egg and no URL mutation.

`node tests/vidlove-current.cjs` and `npm run validate` pass. Manifest v1.20.88 / VidLove v2.1.1, 36 providers. Android playback remains to be confirmed on the user's device; fixture/API success is not playback proof.
