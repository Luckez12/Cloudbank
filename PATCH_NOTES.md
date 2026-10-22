Cloudbank 1.20.68 — VidRock 2.0.0

Apply the ZIP using the existing Cloudbank patch workflow. Includes manifest.json, providers/vidrock.js and a synthetic-fixture regression test. No YML, deletion scripts or VUEO application changes.

Changes
- Rebuilt from the current vidrock.net website API. Uses the requested TMDB ID, media type and season/episode, including season zero. No title, movie, device or CDN-server exceptions.
- Reads the public AES-GCM key from the current website bundle and authenticates encrypted URLs before use. Caches the public key only; no saved playback tokens. Removes the obsolete 404 domain feed.
- Sets HLS MIME explicitly, preserves website Referer/Origin/User-Agent, resolves relative segment URLs against final redirects, and returns a selected 720p+ media playlist rather than an unrestricted master.
- Checks the first segment's transport independently of misleading HTTP Content-Type. Rejects image/HTML responses and PNG-prefixed video. Does not add a media proxy or rewrite segment bytes.
- Three concurrent routes, at most three sources, 24 request budget and 17.5 second total deadline. Slow hosts can still yield fewer sources.
- Retains original-language labels, dual including original and unknown audio. Explicit foreign-only labels are excluded when original language is known. Labels are API evidence; actual audio tracks remain unverified.
- Retains the existing provider display formatter.

Runtime limits
The current native VUEO fetch API exposes text, not raw bytes. Native checks use HLS resolution metadata and a TS/PES or MP4 text prefix; they are not binary or codec probes. A direct media playlist with no resolution evidence is skipped in that runtime. Binary-capable runtimes also check TS sync and H.264 SPS dimensions. Cropped 1920x800 is classified as 1080p; 1280x534 as 720p. External-audio-group-only renditions and unsupported HLS encryption are skipped.

Validation
- npm run validate: 41 providers.
- node --check providers/vidrock.js.
- node tests/vidrock-website.cjs: GCM vectors/tampering, key rotation, routing, MIME, redirects, quality, native fallback, synthetic SPS, bad payloads, audio and request bounds.
- Live website API, HLS playlists and segment samples were inspected. Live text-only replay resolved TV sources (Orion 1080p and Luna 720p in separate runs). Some hosts and earlier movie discovery requests timed out. A repeat movie run decoded four API routes but reached the 17.5 second budget with zero eligible completed sources. Native direct leaf playlists without resolution metadata were excluded, rather than guessing quality. Network/segment checks do not confirm Android playback. Test movie and TV playback on the device and supply the new provider/player debug log if it fails.

Deletion queue
NetMirror and Peachify remain pending deletion and are still in this manifest. This patch deletes neither.
