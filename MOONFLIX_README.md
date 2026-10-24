# MoonFlix v2.0.1

Upload providers/moonflix.js and manifest.json to matching repo paths. No YML or VUEO app changes.

Fix missing website playback step: exact TMDB → main API → backup only when needed → getStreamPlaybackUrl-equivalent website proxy → verify HLS → return that same proxy URL and headers to VUEO. Existing proxy URLs are not double-wrapped. URL query tokens are encoded without modification. Upstream Referer/Origin are sent using the website proxy query contract; unrelated API/source headers are not leaked to proxy. No third-party proxy outside the website flow is added.

Live check: TV 1399 S1E1 proxy master and nested video playlist responded HTTP 200 and rewrote audio, English subtitle and video rendition links to proxy URLs. Movie 1236045 expired signed backup still responded HTTP 403 via proxy; the proxy cannot renew that URL. No claim that this movie is fixed. Main API availability varies by title.

Subtitle English/Malay URL handoff, no subtitle file verification, stop collector at discovery end and 18-second overall discovery budget retained. Embedded HLS audio/subtitle groups remain in the verified master. No Android segment playback or subtitle rendering has been confirmed for this revision.
