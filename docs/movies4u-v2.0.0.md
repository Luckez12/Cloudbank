# Movies4u v2.0.0 / Cloudbank v1.20.64

Copy manifest.json and providers/movies4u.js over the existing repository files. Tests and this note are optional developer files. Refresh the repository in VUEO after uploading.

MoviesHunt was removed from manifest.json. Manually delete providers/movieshunt.js. No deletion script or YML is included. The six providers removed previously remain absent from the manifest.

## Changes

Replaces the old Movies4u engine with the verified website route: current domain map (tested fallback new2.movies4u.garden), lookup.php search, title/year or IMDb-confirmed post, M4uLinks quality/exact episode selection, HubCloud's supplied intermediate download page, and range-validated storage video.

Shared movie link pages are fetched once. Up to three independent host routes run in parallel; up to three distinct quality/codec sources are returned, H.264 first. Minimum 720p. Original audio, dual containing original, and unknown audio accepted. Explicit dub-only labels and ZIP/packs rejected. File codec and episode/quality labels are checked where available; unknown codec is never assumed to be H.264. No signed video URL cache. TV support is now enabled in the manifest. Unsupported or ambiguous layouts return no results rather than another episode.

## Validation

17 automated checks passed, covering saved real website layouts, exact episodes, IMDb-confirmed website year mismatch, audio policy, minimum quality, shared link deduplication, complete simulated movie/TV host chains, failed hosts, invalid media, and the VUEO response bridge without arrayBuffer.

Repository validation passed with 41 providers. A real 720p x264 Hindi/English sample returned HTTP 206 and Matroska bytes during website inspection. A full provider live run from this development session timed out before search completed; no device playback or end-to-end speed claim is made. Test movie and TV playback in VUEO and share the debug log if needed.
