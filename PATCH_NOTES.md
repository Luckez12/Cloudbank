Cloudbank 1.20.74 — VidRock 4.0.0 Direct Master HLS

Apply this single combined patch. Includes provider, manifest, delete list and regression tests. No VUEO app files, dependencies, YML or executable deletion scripts.

Requested behavior
When the API URL serves an HLS master, return that original/final master URL immediately after the one playlist fetch. Preserve every rendition and audio group. Return explicit application/x-mpegURL, original website headers, isAdaptive=true and quality=Auto. Advertised available/max resolution metadata does not lock playback to a rendition. The player selects quality and performs the child-playlist/segment loading during playback.

Remove provider-side rendition selection, child-playlist requests, segment/AES-key/init probes, SPS inspection and the prior rendition-recipe cache. Remove the 720p minimum. A master with only lower or unknown resolution metadata is still usable; adaptive playback may select any rendition the master offers. Master syntax and HTTPS rendition URI checks remain. HTML and empty/malformed playlists are rejected. Downstream playable bytes are no longer tested by the provider; a valid-looking master can still fail in the player if its downstream links are broken.

If the API serves a direct HLS media playlist, return that playlist without segment probes. If it serves a JSON list of separate quality URLs instead of a master, select the highest advertised URL and read its playlist; do not synthesize a master. Normal master routes need one host fetch, rather than a master + selected rendition + first segment.

Unchanged
Exact TMDB movie/TV/episode routing, public AES-GCM URL authentication and automatic public-key refresh, audio-label acceptance rules, up to three sources/three parallel routes and the 17.5s total deadline remain. Source count follows API availability and host responses. No 1500ms alternative cutoff. Subtitle implementation is byte-for-byte unchanged from 3.1.0 (and 3.0.0); existing subtitle timing/cache behavior remains.

Validation
- npm run validate: 39 providers, matching manifest/file inventory.
- node --check providers/vidrock.js.
- node tests/vidrock-website.cjs: original master and opaque-token URLs, Auto quality, 4K/unknown/low advertised resolution, audio groups, media and JSON sources, redirects, no child/segment calls, HLS MIME/headers, GCM tampering and key rotation, exact TV/specials routing and invalid input.
- node tests/vidrock-latency.cjs: two original masters retained, one host fetch each, no derived child/segment requests, cold/warm/rotating roots, subtitles, deduplication, deadline retention and cleanup. Old recipe/segment expectations were replaced to match this new contract.
- node tests/vidrock-subtitles.cjs: subtitle parsing regression checks still pass; obsolete recipe-cache assertions removed.
- Controlled synthetic cold replay: 3.1.0 11477ms / six host requests / two links; 4.0.0 3894ms / two host requests / two original masters. Fixture timing is not a handset speed guarantee. The player still loads child playlists and segments after selection.
- Live native-text-style run for the last reported movie returned Luna's original master with advertised 1080p and 720p, Auto quality and 32 subtitle tracks. API discovery took about 9.3s in that environment and Orion timed out; the run returned one master in 16.3s. No actual phone playback test was performed. This confirms the master-return path, not playback or a fixed latency improvement on the phone.

Test
Apply/build, search and play both available server links. Cards show Auto rather than a fixed 1080p/720p. Logs should show childFetches=0 segmentProbes=0 for returned HLS routes. Share provider/player logs if playback fails.
