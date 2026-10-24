# Viduki v1.0.0

Upload providers/viduki.js and manifest.json to the matching repo paths. Remove the files listed in DELETE_FILES.md manually through GitHub. No YML is bundled or needed. Mapple and Castle are preserved.

Route: exact TMDB → Viduki API 1 player → browser-observed media → small HTTP check. Website subtitle endpoint rezesubs.com is requested in parallel; missing subtitles do not block video. No download-token route, title search, all-API scan, retry loop or segment-size estimation.

Public website Masterplan playback was observed advancing to 8 seconds. This does not verify the Android bridge handoff. Provider bridge and HTTP logic were tested using controlled fixtures; test the patch in VUEO. API 1 internal server fallback belongs to the website.

Known limits: unknown audio stays unlabelled; only explicit dub-only metadata is rejected. Captured known quality below 720p is rejected; adaptive sources remain Auto when their selected rendition is unknown. A master with only sub-720p renditions is rejected. Subtitle availability varies by title. No claim that every title has original audio or subtitles.
