# KShow123 1.0.0

Adds KShow123 (TV only). Repository version: 1.20.20.
Uses shared VUEO metadata with TMDB fallback, native search, exact title aliases, explicit season matching and preceding-season episode totals for continuous numbering. Every chosen episode must match the requested TMDB air date within one day for timezone labels.

Extraction follows the observed live site player: videoList -> api.kshow123.tv/ajax/ POST -> OpenSSL-compatible AES decoding of HLS/MP4 and subtitle fields. Never evaluates remote JavaScript. Runtime is bounded to 18.5 seconds and up to four servers. Returns the site playlist without inventing a master URL. Placeholder intro.vtt is excluded.

Validation: all 51 providers passed repo validation. Real saved Running Man HTML/API responses passed exact title selection, extraction, wrong-date rejection, continuous numbering and placeholder subtitle exclusion. Live HTML and API requests succeeded. Direct CDN playlist validation returned HTTP 403 from this environment; Android playback and subtitle rendering remain unverified. Entry is marked limited. Test in VUEO and export a provider log if playback fails.

Known limits: strict matching can reject missing aliases, split seasons or inconsistent site air dates. No guessed title/episode fallback. Subtitle tracks depend on the server; English text may be burned into the video instead.

Apply at repository root: overwrite manifest.json and add providers/kshow123.js plus this note. No YAML/workflow changes.
