# MoonFlix v2.0.0

Upload providers/moonflix.js and manifest.json to matching repo paths. No YML or VUEO app change.

Current website assets inspected: main.js?v=4 and player/media.js?v=19. Flow: exact TMDB → filmu-mpbu.onrender.com/api/stream → backup vidzy-wlqs.onrender.com/api/stream only when main fails or yields no eligible playlist. Query parameters match website movie and TV routes. Retired Railway routes and old extractors removed. No title search, WebView, external player sweep, repeated media probes or segment-size calculation.

API/playlist requests share an 18-second overall budget. Playlist verification is required here because current backup returned an expired signed URL. Do not return known 403/HTML/invalid playlists. Captured known quality below 720p is rejected; adaptive master is Auto. Shared original language is compared with declared source audio and advertised master audio languages when present; unknown audio is not asserted to be original.

Main playlist retains embedded audio/subtitle groups. Sidecar URLs from API and one website GitHub index are filtered to English/Malay. Index runs concurrently, stops at discovery completion, no subtitle files are downloaded by provider. Secondary website subtitle scraping routes and external subtitle addon lookup are omitted to keep requests minimal.

Live observations: movie 1561726 main returned unavailable; backup returned a signed HLS URL that responded 403, so this title cannot be claimed working. TV 1399 S1E1 main returned HLS, HTTP 200 with English audio, 1080p/720p variants and embedded English subtitles. Media playlist and video segment playback on Android have not been confirmed. Fixture tests cover API query fidelity, fallback/errors, metadata mismatch, quality/audio checks and subtitle filtering. No guarantee for every title or fixed scan time.
