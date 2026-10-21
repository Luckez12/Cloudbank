# MoviesDrive 4.0.0 — website route rebuild

Cloudbank manifest: 1.20.61. Active provider count: 42.

## MoviesDrive changes

- Replaces two merged legacy engines with one standalone website route.
- Reads the existing public domain map and uses the tested `https://new3.moviesdrive.beer` fallback. Only the active domain is cached (30 minutes); signed media URLs are never cached.
- Searches the current website `search.php` endpoint, using title first. Requires exact normalized title/alias and release year or matching IMDb ID, with the requested season for series. Removes the old unrelated-first-result fallback.
- Supports the current descriptive heading followed by quality-button heading layout.
- Follows the actual MDrive archive → HubCloud → supplied `hubcloud.php` page → explicit R2 storage link route. Does not treat a player page as a media file.
- Handles MDrive's extra “Menu” H1 without mistaking it for the title.
- Selects the exact TV episode and season, respecting episode boundaries. ZIP/combined-episode packs, hidden links and sub-720p files are rejected.
- Accepts original audio, dual/multi containing the original language, and unknown audio. Known dub-only/non-original language lists are rejected. Labels remain dual/unknown where appropriate; the provider does not force the default audio track.
- Prefers 1080p, then 720p, followed by higher-resolution alternatives; returns the first validated direct file to avoid unnecessary host extraction.
- Uses a bounded HTTP Range request and file signature when binary response APIs exist. On runtimes without `arrayBuffer`, requires HTTP 206, a plausible total file size and a video filename instead. HTML/JSON responses and servers ignoring Range are rejected.
- Preserves real file size and embedded audio/subtitle tracks. Does not invent external subtitle URLs.
- Total discovery budget 18.7 seconds; normal requests capped at 4.3 seconds, domain map at 2 seconds. Existing stream display formatting retained. No app or YML changes.

## Validation

19 fixture checks pass. They cover matching, audio policy, current heading layouts, exact episode boundaries, packs, hidden/ad/player links, complete movie/TV routes, HTTP 403, invalid signatures, ignored Range requests, runtime binary API fallback, invalid input and query-token redaction.

The new parser was also run against actual captured website search results, post pages, MDrive archives and HubCloud download pages for:

| Sample | Parsed routes | Final file probe | Actual container tracks |
| --- | --- | --- | --- |
| No One Gets Out Alive (2021) | 1080p, 720p | HTTP 206, MKV, 1,973,138,950 bytes total | H.264 1920×800; Hindi + English AAC; embedded subtitles |
| A Korean Odyssey S01E01 | 1080p, 720p | HTTP 206, MKV, 509,018,308 bytes total for tested 720p file | HEVC 1280×720; Hindi + Korean AAC; English SubRip |

Only the first 256 KiB of each sample was fetched for ffprobe inspection. This verifies container headers and declared tracks, not a full playback session or full-catalog correctness. VisionQuest website search also returned the exact IMDb-matching Season 1 post.

A direct Node-fetch run of the new provider in the hosted runner timed out during search after approximately 6.3 seconds, including the domain-map fallback. The separate website/host HTTP route and final file probes succeeded. Success inside the app's normal time budget is therefore not claimed. VUEO playback and discovery speed still require a device test.

## Requested removals

The manifest removes the queued providers DooFlix, HDGharTV and HindMoviez. Earlier removals of AllMovieLand, CineFreak and CinemaCity remain in effect. MovieBox 3.0.1 is retained.

This ZIP intentionally contains no deletion script. After applying it, manually delete these files and commit the deletions:

- `providers/dooflix.js`
- `providers/hdghartv.js`
- `providers/hindmoviez.js`

If earlier removals have not yet been completed, also delete `providers/allmovieland.js`, `providers/cinefreak.js` and `providers/cinemacity.js`. The ZIP workflow copies files but cannot physically remove files. Repository validation requires every remaining provider file to be listed in the manifest.

Run `node tests/moviesdrive-website.cjs` and `npm run validate` after the manual deletions.
