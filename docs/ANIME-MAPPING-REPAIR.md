# Cloudbank anime mapping repair — 1.20.1

Tested on 10 October 2026 against Luckez12/Cloudbank main commit d4c4546.

This patch repairs the mapping dependency for six providers. It does **not** establish that their video playback works. All 12 sampled live provider calls returned zero streams; the remaining failures are downstream of mapping or are network/host failures.

## Changes

- HiAnime, HiAnime V2, AnimePahe, AnimePahe V2 and AniZone V2 no longer call the deleted Hugging Face resolver.
- AnikotoTV's invalid `/api/v2/tmdb` request is adapted to ARM's `/api/v2/themoviedb` route and the response array is translated to the schema expected by its original code.
- TV mapping checks the requested season, identity, episode broadcast date and MAL episode number using ARM and AniZIP. TMDB season dates take precedence; Cinemeta supplies dates when TMDB data is unavailable. A one-day tolerance covers broadcast timezone differences. Split entries and same-day episode order are handled. Missing or ambiguous matches return no mapping rather than guessing a season or episode.
- A title already supplied by a verified mapping satisfies the exact MAL-title lookup, avoiding a redundant Jikan request. Unrelated Jikan requests, including existing movie search paths, retain their original behavior.
- Document cache: 20 entries, five-minute expiry; resolved mappings and titles: 32 entries per provider instance. Failed requests can retry. Each helper network request has an eight-second soft deadline; it does not require AbortController. The six provider wrappers now allow up to 45 seconds instead of 19 seconds. Other provider timeouts remain unchanged.
- All original upstream source bytes remain unchanged. The mapping helper is embedded outside the source markers so each provider stays standalone. Display formatting, URLs, headers, subtitles and settings retain their existing behavior.
- Repository manifest is 1.20.1. Only the six affected provider versions increase by one patch number. All 103 providers remain registered; no provider is deleted or disabled.

## Verification

- 333 Node tests and 7 Python tests pass, including all imported-source hash checks.
- Repository validation passes for all 103 providers.
- Tests exercise actual upstream resolver entry points for all six providers with metadata fixtures. Tests cover incorrect seasons, split numbering, same-day releases, timezone dates, ambiguous matches, retry behavior, and Anikoto's first numeric TV request before any metadata call.
- A real captured Demon Slayer response verifies the actual mapping schema. Fixtures retain matching fields only, excluding synopses and artwork.
- Direct live mappings succeeded for Demon Slayer S01E01 → MAL 38000 / episode 1; S02E01 → MAL 49926 / episode 1; S03E01 → MAL 47778 / episode 1. S99E01 was correctly rejected.
- The final live run called every affected provider for Demon Slayer S01E01 and Spirited Away. The table below reports observed behavior, not a permanent availability judgment. Datacenter 403 responses do not establish behavior on an Android device.

| Provider | TV mapping result | Remaining live failure |
| --- | --- | --- |
| HiAnime | Reached MAL 38000 host lookup | MegaPlay did not yield streams; alternate hosts returned 404/502. Movie MAL search still returned Jikan 502. |
| HiAnime V2 | Reached MAL 38000 host lookup | Same extraction/host issue; movie MAL search still returned Jikan 502. |
| AnimePahe | Mapping and title lookup passed; reached source search | Source domains returned 403; TV call hit the 45-second wrapper budget. |
| AnimePahe V2 | Mapping and title lookup passed; reached source search | Upstream worker proxy returned 403. |
| AniZone V2 | Mapping and title lookup passed; reached anime listing | Current upstream card/search parser did not produce a matching source from the returned page. |
| AnikotoTV | Reached MAL 38000 TV and MAL 199 movie host lookups | MegaPlay page/getSources responses did not produce streams. |

No complete playback, segment decoding, Android rendering, subtitles or seeking was proven. The next repair should inspect the host response schema/extraction paths and source search parsers, separately from this mapping fix.

## Applying this patch

Upload the ZIP to the existing Apply ZIP workflow. Every entry is relative to the repository root: `providers/...`, `scripts/...`, `tests/...`, `docs/...` and `manifest.json`. Apply must finish successfully before running Validate, or run Validate manually as previously configured. The ZIP contains no YML files and does not alter either workflow.

After applying, refresh the Cloudbank local scraper installation in Nuvio using:

```text
https://raw.githubusercontent.com/Luckez12/Cloudbank/refs/heads/main/manifest.json
```

Rebuild embedded helpers after editing the canonical mapping code:

```sh
python3 scripts/embed_anime_mapping.py
npm test
npm run validate
```
