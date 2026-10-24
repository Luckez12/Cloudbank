# MovieBlast v2.0.0

Upload providers/movieblast.js and manifest.json to matching repo paths. No YML or VUEO change. Remove providers/moonflix.js manually per DELETE_FILES.md.

Entire legacy obfuscated/merged implementation replaced with one direct HTTP provider. Shared VUEO metadata first (zero extra TMDB requests); one TMDB fallback only when title/year/original language is missing. At most two title searches (display title then different original title). Require exact normalized title, year and media type, reject ambiguous matches, verify detail tmdb_id equals requested ID. TV selects exact season/episode only.

Filter explicit non-original languages, unknown audio, low quality below 720p, embed/DRM/download-only entries and inactive links. Multi-audio only accepted if audioLanguages explicitly includes original. Unknown resolution allowed. Sign URL using existing upstream HMAC-SHA256 protocol; preserve existing query parameters. No video HEAD/GET, extra subtitle file download, or WebView. Returned links are not playback-verified. Runtime crypto-js dependency retained for signing only.

English/Malay subtitle URLs from detail/episode are forwarded without cue checks. No subtitle scraping beyond supplied API data.

Live search Spider-Man returned 11 results. Detail for No Way Home matched TMDB 634649 and listed original English 1080p/720p sources. A signed source check responded 503; Android playback unverified. Tests use controlled fixtures for matching, original audio/quality, episode selection, subtitle language, HMAC signature/query preservation and metadata call count.
