# Mapple v2.0.0 — candidate for VUEO testing

Extract ZIP directly at the Cloudbank repository root alongside manifest.json. Refresh to Mapple v2.0.0. No app, workflow or dependency change; no deletion. Vidnest remains at 2.2.0.

Evidence 24 October 2026: movie detail HTML for Animals TMDB 1236045 returned 200 and linked /watch/movie/1236045. Current website scripts specify /api/ui/session and /api/media-session, not legacy /api/request-token and /api/playback-init. Browser read-only inspection confirmed Animals video readyState 4, paused false, currentTime 31 seconds, 1920x1080 and no video error. This is website playback evidence, not native VUEO playback evidence.

HTTP session check: /api/ui/session returned token metadata; /api/media-session accepted it and returned success/requiresPow with difficulty 18. An earlier legacy playback-init call rejected its token with 401. Two complete provider runs using a curl-backed fetch adapter timed out at initial website read (4s then 7s); native API/media extraction therefore is not live-confirmed. Current script and mock tests establish the intended route/protocol, not guaranteed media availability.

Rebuild: load actual watch route for fresh session cookies, get current UI token, request current media session, submit normal server-issued PoW when required, then encrypted stream route. Isolated provider-owned SHA-256 avoids the restricted runtime crypto facade. Work yields after about 5ms CPU chunks, bounded to 8s and scan deadline, with difficulty validation. No cached or fabricated token, key, proof or signed URL. No legacy fallback replay. HTTP 429 stops discovery without retrying.

Use two workers across website-observed mapple, s2, s19, s10 sources; collect up to two finished sources and allow 600ms after the first source rather than awaiting 18 hosters. 17.5s total deadline, 4s API reads, 7s initial page, 3.5s media checks. Cookies stay per scan and are only sent to Mapple origin; source media headers remain attached to returned URLs. Cleanup aborts requests when supported and cancels local waits.

HLS roots retain the original master or media-playlist URL. Do not enumerate variants or fetch segments/keys. A valid adaptive master is Auto; a valid single media playlist is Unknown. HTML and invalid playlists produce no source, rather than an unconditional Auto entry. Direct mp4/mkv/webm paths use HEAD, not a movie GET through the JS bridge. Existing native response-body limits still apply to playlist/API text.

English/Malay sidecar metadata is queried alongside video; source labels retained. Already available captions are attached at source completion, pending lookups stopped; late captions may be omitted. Caption retrieval failure cannot block video. No subtitle file GET during discovery.

Validation: Node syntax, npm run validate for 36 providers, and tests/mapple-current.cjs pass. Mock workflow covers current UI/media session and normal PoW submission checked with independent Node SHA-256; entire standalone provider loads without host modules; exact TV route, cookie isolation, source headers/signed query preservation, media playlist acceptance without fake Auto, EN/MS labels, rejection of HTML. No APK/device playback test has been performed.

Device next: Animals (2026), TMDB 1236045, then a requested episode. Send the provider debug log, especially website/ui-session/media-session/POW/source stage. If blocked or unavailable, logs should identify that stage; this ZIP is a test candidate, not a confirmed playback repair.
