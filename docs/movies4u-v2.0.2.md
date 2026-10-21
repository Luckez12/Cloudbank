# Movies4u v2.0.2 / Cloudbank v1.20.66

Overwrite manifest.json and providers/movies4u.js, then refresh the repository in VUEO. No YML or deletion scripts.

## Identity fix

v2.0.1 only handled a small set of platform Original suffixes. This failed for Masterplan – Amazon Prime because it still required the complete displayed title to match TMDB, even after an IMDb search found the correct post.

v2.0.2 removes the platform whitelist. When TMDB supplies IMDb, query that identifier first. Search hits are candidates only: open up to three distinct candidate posts, reject mismatched or ambiguous IMDb identifiers, and verify movie type or requested TV season. A verified post IMDb establishes identity regardless of extra title text. If the post has no usable IMDb, exact title/alias plus year is still required. M4uLinks page titles must match the verified parent post or metadata title, with the parent's displayed year. All episode, quality and media checks remain.

The incomplete label [Hindi ORG. + Multi Audio] is accepted as unknown audio, without claiming English is confirmed. Explicit dub-only lists remain rejected.

## Validation

21 checks passed: actual saved Animals, Masterplan, Bad Apples and TV page layouts; arbitrary decorated titles verified by IMDb; wrong IMDb, conflicting type/season, wrong first search hit, no-ID title/year requirements, incomplete multi-audio labels, invalid files, exact episodes and partial failures. The Masterplan integration uses real post/link-page layouts with simulated host/media responses and returns three validated alternatives. Repository validation passed with 41 providers.

Independent live inspection followed Masterplan's real 720p HubCloud route to storage: HTTP 206, bytes 0-8191/1222903124, MKV signature 1a45dfa3, filename Masterplan.2026.720p.HEVC.WEB-DL.Multi.Audio.ESub.x265.mkv. This proves media access, not Android playback. H.264 is preferred when available; other codecs remain labelled honestly. Test in VUEO and share the new log.

MoviesHunt and the six earlier removals remain absent from the manifest. Manually delete providers/movieshunt.js if still present.
