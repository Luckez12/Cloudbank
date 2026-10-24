# HDHub4u v1.7.1 — targeted polish

Upload providers/hdhub4u.js and manifest.json to matching paths. No YML or VUEO changes. Existing extraction engines, server routes, verification behavior, timeout budgets and fallback order preserved.

Default domain updated from retired new3.hdhub4u.free to new8.hdhub4u.cl. Keep dynamic domain discovery, validate origins, reject retired .free and credential-bearing override URLs. Correct HLS type/MIME; remove guessed 1080p when a media playlist has no known resolution. Normalize English/Malay sidecar languages and MIME from URLs/declared formats without fetching subtitle files. Playback URLs, headers, signed queries and subtitle headers are preserved.

The supplied performance log records VIDEO_FIRST_FRAME and selected English SUBTITLE_CUES_DELIVERED; it does not identify which extractor succeeded or include a full provider scan trace. No extractor was removed based on incomplete evidence. Device regression testing required after patch.

Manifest excludes retired MovieBlast and MoonFlix; DELETE_FILES.md lists physical files to remove. Tests cover legacy domain rejection, updated defaults, HLS metadata, subtitle language/MIME and preservation of URLs/headers.
