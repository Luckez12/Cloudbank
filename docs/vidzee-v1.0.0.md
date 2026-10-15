# VidZee 1.0.0

Adds movie/TV discovery through the current VidZee player API. Repository version 1.20.23; provider version 1.0.0. Existing KShow123 1.0.2 is preserved.

Audited sources: https://vidzee.wtf/ and https://player.vidzee.wtf/embed/movie/550 ; current player asset Ads-B94UKDII.js (checked 2026-10-16 Malaysia). The player uses core.vidzee.wtf /streams/movie/{id} and /streams/tv/{id}/{season}/{episode}. Public e=0 responses were verified for movie Dcloud, movie English, movie Acme English and TV IPcloud. This response encoding provides URL/language/headers without requiring the browser's WebAssembly decoder.

Server order follows the website: Dcloud, API-discovered Acme languages (up to four), TCloud, IPcloud, Hindi, English. Individual server failures do not discard successful results. Remote scripts are not executed. The provider has an 18-second total budget under the 20-second descriptor. Acme discovery, subtitle metadata and fixed server requests overlap; requests have individual limits.

Returned master HLS is kept as one source per server. Quality is derived only from RESOLUTION fields in that returned master. A media-only playlist or an inaccessible playlist receives quality auto. An HTML response masquerading as HLS is rejected. The provider does not invent a master URL or fan out quality variants. A discovered URL with an unavailable validation request is explicitly logged as unverified. This does not prove playback.

External subtitle URLs come from /subs with stable provider-prefixed IDs. English, Malay and Indonesian sort first, while all supplied languages and alternate tracks are retained. Retrieval of subtitle metadata does not prove cue availability or rendering. No translation or subtitle conversion is performed.

Validation:
- Repository validation passed for 52 providers.
- Tests cover movie/episode routing, invalid input, server failure isolation, unsupported encryption diagnostics, Acme discovery, server order, request headers, HLS parsing, HTML rejection, subtitle ordering/deduplication and sanitized logs.
- Tests with saved real Dune: Part Two (TMDB 693134) API/HLS responses returned a movie source with unknown resolution, and 194 upstream subtitle entries.
- Tests with saved real Breaking Bad (TMDB 1396 S1 E1) IPcloud API/master returned a 720p source.
- A simulated 2160p master verifies the quality parser only; it is not evidence of a live 4K stream.

Limits: live 4K has NOT been verified despite the site's 4K claim. Sample TV master advertised 1280x720; sample movie playlist exposed no resolution. Some upstream servers returned HTTP 502; some requests timed out. Subtitle cue fetches failed from the development environment. Android playback and subtitle rendering need app testing. Direct TMDB addressing does not independently verify the title/episode inside the media. The provider remains marked limited.

Apply this ZIP at repository root. Adds providers/vidzee.js, docs/vidzee-v1.0.0.md and tests/vidzee.mjs; updates manifest.json only. No YAML/workflow changes. Existing installed providers remain present.
