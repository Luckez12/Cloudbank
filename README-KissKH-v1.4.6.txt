KissKH v1.4.6 — user-requested title-first selection

Extract over repository root. Replaces v1.4.5 provider and manifest.
No VUEO changes, extra requests, media checks, or subtitle changes.

1. Search exact normalized title/aliases; duplicate catalogue IDs count once.
2. One exact title: use it regardless of year or season label, including E1.
3. Multiple exact titles: use requested season for TV, then year if still tied.
   Up to three unresolved candidates can have their detail year compared.
   Remaining ambiguity returns no source; no arbitrary first-result fallback.
4. Revalidate returned detail ID, title and movie/TV type.
5. TV: select the exact episode number once; no offset or other episode.
   Movies retain the existing requirement for one episode entry.
6. Resolve video and available EN/MS subtitles in parallel as before.

A unique candidate is intentionally accepted without verifying requested season
or premiere year, following the requested policy. No title, TMDB ID, season or
episode-specific rules. Cache namespace updated to discard older mappings.

Validation: 68 provider regression checks pass; 25-provider manifest validation
passes. Checks cover unique wrong-year movie, unique mismatched season, E1,
continuous E821, duplicate IDs, multiple-season/year candidates, unresolved
ambiguity, exact episode absence/duplicates, and existing subtitle pipeline.
Device playback for the reported movie remains untested.
