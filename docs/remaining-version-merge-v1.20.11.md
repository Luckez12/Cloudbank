# Cloudbank 1.20.11 — remaining version consolidation

Apply this patch at the repository root after the Castle, VixSrc, HDHub4u and 4KHDHub patches through 1.20.10. It merges the remaining 16 provider groups, removes 17 standalone variant entries from the manifest, and leaves 76 provider entries. Provider names retain the prior icon cleanup.

Extract and overwrite the included files, then manually delete the paths in `docs/remaining-version-files-to-delete.txt`. The ZIP contains no YML, workflow, deletion script or automatic provider removal. No ordinary provider is removed by this patch.

## How selection works

The established provider remains the first extraction path, including its existing Test-Plugin/original fallback where present. A successful result within five seconds returns without starting another engine. An empty/error result starts the next eligible engine immediately; an unresolved primary starts it after five seconds. Each alternate has a six-second budget; MovieBox V3 is attempted only if V2 produces no usable result. The public scan returns within 18.5 seconds.

A successful primary returns immediately, adding only alternate results already completed. It does not wait for an unfinished alternate. If the primary fails or reaches the scan deadline, completed alternate results are returned. Later completions cannot change the returned array. Alternate requests and response-body reads have bounded waits, and expired alternate scopes cannot start further requests. This is not a guarantee that a host cancels network requests already in flight.

The common adapter keeps headers, subtitles, audio, quality, HTTP(S)/magnet URLs, season zero and additional arguments. Exact duplicate entries are removed, while distinct server/audio entries are retained. Existing PlayIMDb display formatting wraps the final result once. Alternate metadata uses the shared discovery context, rejecting explicit mismatched IDs. Anime alternates retain the repaired episode/title mapping helper outside their untouched upstream cores.

## Audit and retained paths

These descriptions record the supplied source snapshot; they do not certify that a remote service is currently available.

| Ordinary provider | Embedded versions | Retained extraction paths |
| --- | --- | --- |
| KissKH | V2 | Existing Test-Plugin/original discovery first; alternate kkey generation and episode mapping retained. |
| MovieBox | V2, V3 | Existing extraction first; V2 mobile region APIs and web-player route, then the smaller V3 mobile route. |
| AniZone | V2 | Existing cookie/Livewire and structured mapping flow; alternate title/card discovery with repaired anime mapping. |
| AnimePahe | V2 | Existing domain rotation and Kwik/Pahe resolution; alternate worker-assisted extraction and domain controls. |
| AllMovieLand | V2 | Existing `.you` route; alternate `.one` route. |
| CinemaCity | V2 | Existing sitemap/title verification and download handling; alternate direct HTML route. |
| DahmerMovies | V2 | Existing index hosts; alternate quality/codec selection and directory parsing. |
| DooFlix | V2 | Existing path first; alternate implementation of the same panel/Molop API family. |
| HiAnime | V2 | Existing genre/episode-aware anime path; lean alternate mapping and sub/dub controls. |
| Kurage | V2 | Existing path first; alternate implementation of Kurage with AniList/ARM/Cinemeta discovery. |
| MovieBlast | V2 | Existing signed API implementation first; alternate implementation retained. |
| MoviesDrive | V2 | Existing domain refresh, index/quality and Pixeldrain handling; alternate domain and Hubcloud handling. |
| MoviesMod | V2 | Existing wider instant/resume/cloud/VideoSeed extraction; alternate domain and DriveSeed handling. |
| NetMirror | V2 | Existing cookie/bypass flow; alternate NewTV bootstrap and platform flow subject to original restrictions. |
| UHDMovies | V2 | Existing cookie and VideoSeed/DriveSeed flow; alternate domain/extraction flow. |
| VidEasy | V2 | Existing Wings/local-decrypt/Vidking extraction remains active. The previously disabled V2 source is preserved but never invoked. |

Settings retain primary defaults, add missing alternate controls, and merge selectable options by value. They do not claim that every setting applies identically to every internal engine.

NetMirror retains `supportsExternalPlayer: false`. Its alternate retains the iOS restriction. It is skipped on iOS and when the host cannot identify its platform; a supplied Android platform or recognizable Android user agent permits it. This avoids silently removing the original platform restriction.

## Validation

- `npm test`: 242 JavaScript tests and 7 Python tests passed.
- `node scripts/validate.mjs`: all 76 provider files loaded and manifest validated.
- Embedded upstream core hashes match the audited source records in `docs/remaining-version-merge.json`; the report also records merged-file hashes.
- Regression coverage checks fast primary success, immediate/delayed fallback, MovieBox V3 ordering, metadata reuse, settings, platform/disabled flags, preserved playback metadata, response-body timeouts, expired scopes, late completions and all six anime mapping resolver paths.

These are source-integrity and offline/fixture tests. Live playback across all 16 services has not been verified. Test in VUEO before deciding which ordinary providers to remove in the later cleanup.
