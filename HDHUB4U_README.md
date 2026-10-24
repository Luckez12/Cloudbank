# HDHub4u v1.7.2

Provider-only patch. Upload providers/hdhub4u.js and manifest.json. No YML or VUEO app changes.

Fast movie path: WATCH/PLAYER-2 race first; return first eligible result without the old 1400ms collection grace. Quality/download tasks are not even created until both site streams fail or the 3000ms fast-stage budget expires. Fallback returns first eligible quality instead of waiting for every quality. Existing extractors and legacy fallback are retained. A slow site-stream stage may delay download-only fallback compared with previous all-parallel behavior; no fixed speed guarantee. Already running tasks can still exist until VUEO cancellation, but no download tasks start on successful fast HLS discovery.

Remove synthetic 1080p from PLAYER-2/site link and TV defaults. Master playlists stay Auto instead of inheriting a guessed 1080p label. Known sub-720p renditions are rejected; unknown allowed.

Read audio language tags from the playlist already fetched, without another network call. Compare with shared/TMDB original language. Explicit non-original-only playlist/source labels are rejected; multi-audio masters containing the original are retained. Set audioLanguages and original audioLanguage when known. This preserves required HLS audio groups; it does NOT rewrite a muxed file or remove Hindi tracks from a mixed master. A media playlist without audio labels remains unknown and is not falsely labelled original. Legacy final outputs receive known low-quality/audio filtering when metadata is available.

English/Malay subtitle handling and existing URLs/headers remain. Tests cover first-good completion without grace, no quality task startup on HLS success, dub-only and 480p rejection, mixed English/Hindi evidence, master Auto and original-language metadata. Device playback and actual speed require regression testing.
