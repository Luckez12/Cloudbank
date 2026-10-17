# Movix VF 1.1.0 — original audio

Extract at Cloudbank repository root, then refresh providers in VUEO. No YML included.

- Exclude foreign VF dubs and unverified generic audio labels before resolving links.
- Retain VO/VOSTFR and audio explicitly matching TMDB's original language.
- Retain VF for a French-language original: it is not a foreign dub in that case.
- For ambiguous MULTI/DUAL sources, inspect the HLS master during the existing redirect request. Retain only if an audio LANGUAGE entry matches the original language. No audio/video segment or child-playlist requests are made.
- Run Cpasmal fallback if Purstream fails or returns no eligible original source. Filter language before its five-host limit. One bad embed does not discard successful embeds.
- Preserve endpoint routes, playback URLs, source headers, content and episode titles, and the existing provider identity.
- Do not invent original audio or a replacement dub when original sources are absent. Result can be empty when the provider has no eligible original version.
- Stop carrying guessed H.264/AAC/VF metadata into the new results; resolution is populated only when provided in the source label.

Validation:
- JavaScript syntax check passed.
- End-to-end provider sandbox tests passed: movies/TV, Japanese originals versus English/French dubs, VOSTFR/VO, French originals, dual-only uncertainty, manifest-backed MULTI acceptance/rejection, no segment requests, empty/error fallback, five-host ordering and isolated embed failure.
- Live Purstream API returned a MULTI source. Its media host returned a Cloudflare block from this environment; playback and original-language availability on that live stream were not verified. Live Cpasmal sample returned an error.
- The upstream domains.json URL returned 404; the existing movix.cash fallback successfully reached the API. This patch retains both routes.

Manifest is based on the latest retrieved Cloudbank manifest and carries PlayIMDB 2.0.4 from the preceding patch; other provider entries are preserved. No app/player files are included.
