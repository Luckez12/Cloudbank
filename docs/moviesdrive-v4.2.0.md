# MoviesDrive 4.2.0 — parallel quality extraction

Cloudbank manifest 1.20.63. Provider count remains 42; all earlier removals remain in effect.

## Trigger and result

The user's MoviesDrive 4.1.0 log for TMDB 1561726 returned three playable sources with subtitle cues and VIDEO_FIRST_FRAME events. Discovery took 9,159 ms and 15 HTTP calls. The three file routes were resolved sequentially.

Version 4.2.0 processes the three highest-priority independent quality/codec routes concurrently, with a maximum of three active route requests. Each route still performs its own archive → HubCloud → supplied download page → Range/media validation steps in order. A fourth route starts only as fallback after the first batch settles and fewer than three distinct files have been collected.

This shortens waiting between independent file routes rather than removing validation or reducing the requested source choices. It does not promise three files when the website only offers fewer files or requests fail.

## Preserved behavior

- H.264 priority, quality diversity, honest unknown/HEVC codec labels and final sorting remain active regardless of request completion order.
- Up to three distinct validated codec/quality choices, including 720p when available.
- Original/dual-containing-original/unknown audio policy, exact title/year-or-IMDb/season/episode checks and ZIP rejection.
- An 8 KiB bounded Range probe with container codec declarations when readable; filename-based checks on runtimes without arrayBuffer. No unverified player-page URLs or cached signed media URLs.
- Existing 18.7-second total budget and maximum 5.5-second collection window after first success. Valid sources are retained if another route fails.
- No app/decoder changes, no YML and no deletion scripts.

Adds a TIMING line with preHostMs, hostMs, totalMs and peakRoutes to make on-device comparison possible. ROUTE now identifies v4.2.0.

## Verification

27 fixture checks pass. New checks verify overlapping requests with a maximum concurrency of three, unchanged H.264 ordering when request completion order changes, retention on errors and a fourth route that waits for the initial batch to finish.

A synthetic comparison using the same three files and the same 30 ms delay per HTTP call produced:

| Build | Requests | Peak concurrent requests | Sources | Time |
| --- | ---: | ---: | ---: | ---: |
| 4.1.0 sequential | 15 | 1 | 3 | 553 ms |
| 4.2.0 parallel | 15 | 3 | 3 | 238 ms |

This is one simulated-latency benchmark, not a prediction of real website/device speed. The user's earlier device log confirms playback for 4.1.0; 4.2.0 needs a new device test to measure actual timing and reconfirm playback.

Apply the ZIP and test the same title. Compare total discovery time and the new TIMING log with the earlier 9,159 ms result.

Run `node tests/moviesdrive-website.cjs` and `npm run validate` for repository checks.
