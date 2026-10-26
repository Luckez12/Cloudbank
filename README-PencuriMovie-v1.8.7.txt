PencuriMovie v1.8.7 — simplified discovery
Extract over Cloudbank repository root. No VUEO changes.

Active engine no longer fetches extracted playlists, ranges, segments or seek
probes. Per website mirror it selects the first extracted HLS in page order,
otherwise a direct URL. Server numbering and playback headers preserved.
Mirror extraction still runs in parallel. Completed sources collected for up
to 400ms after the first source (or until all mirrors finish sooner), with an
8s mirror-phase limit. Late sources can be omitted. VUEO ends remaining requests
when provider finishes; code ignores late results. Legacy rescan fallback is
not invoked. Old legacy source remains embedded but is not used for discovery.
Single exact movie title no longer rejected by year. Multiple search matches
require unique matching year. Existing title/type matching and extraction
routines otherwise retained. Unresolved Playmogo/VOE/Streamtape extractors were
not repaired by this latency patch. No claim of a fixed scan time or verified
playback: source URL checks now happen during player use, not discovery.

16 mocked regression checks pass; manifest validates 25 providers. No live
Android playback test. No YAML files. Manifest preserves earlier provider patches.
