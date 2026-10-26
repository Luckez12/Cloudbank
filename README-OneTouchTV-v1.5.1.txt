OneTouchTV v1.5.1 — title-first selection

Extract over Cloudbank repository root. Provider patch; no VUEO changes.
Manifest preserves KissKH v1.4.6 and other provider versions.

One exact catalogue title/ID: accept without year/season restrictions.
Multiple titles: use requested season then year; compare detail years if needed.
One exact episode number: accept regardless of season label. Multiple entries
for that number: use season; reject remaining ambiguity. Never substitute a
different episode or select by array position. Movie's single-entry requirement
and detail ID/title/media-type checks retained. Duplicate search IDs (including
case variants) count as one. Cache namespace reset.

No extra requests, metadata numbering lookups, media probes or player changes.
API routes, local/remote decrypt fallback, source headers, subtitles unchanged.
Unique candidates intentionally do not prove requested year/season identity,
as requested. Unknown duplicate candidates remain unresolved.

Validation: 41 OneTouchTV checks, 68 KissKH checks, manifest 25 providers pass.
Regression tests use mocked API responses; no live Android playback verified.
