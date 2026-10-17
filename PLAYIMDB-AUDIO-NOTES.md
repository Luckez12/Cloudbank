# PlayIMDB 2.0.4 — audio label evidence

This is an audio-label correction, not a Japanese audio source fix.

Findings:
- A live API request for TMDB 220542 S1 E1 returned one file_name, three stream_urls, and subtitles. The returned data did not expose audio tracks or original/Sub/Dub variants.
- The imported provider contains no request for alternate audio versions. No supported original-audio selection parameter was established.
- Playback probing from this environment returned HTTP 403. Actual track languages were not verified.

Changes:
- Stop claiming Original-Audio when the filename contains no audio-language evidence.
- Recognize Japanese/JPN, English/ENG and Hindi/HIN filename markers with word boundaries.
- Mark filename hints explicitly. Dual/multi indicators do not promise Japanese audio or a specific complete track list.
- Preserve source URLs, server order, playback headers, subtitles and the original extraction requests. Add no media probes or guessed API parameters.

Apply at Cloudbank repository root. The manifest is based on the current Luckez12/Cloudbank repository snapshot (1.20.43); only repository version and PlayIMDB version are incremented. Compare if your manifest has newer edits. No YML included.

Validation: node --check passed; node tests/playimdb-audio-evidence.mjs passed 49 assertions across 7 fixtures, including the real returned filename. The tests verify that links, subtitles, headers and request count remain unchanged. End-to-end playback and Japanese source availability remain unverified.

A stream containing English audio only still requires another upstream media version to provide Japanese. This patch does not convert audio or create a missing track.
