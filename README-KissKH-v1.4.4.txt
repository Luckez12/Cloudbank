KissKH v1.4.4 — single catalogue episode matching

Extract over Cloudbank repository root. Provider patch only; no VUEO changes.
Normal explicit season matching and subtitle handling remain unchanged.

When an unlabelled exact title cannot match the requested season, reuse complete
TMDB metadata or make one bounded root metadata request. Only accept a single
canonical regular season whose episode count covers the requested episode.
Require one unique exact catalogue title and the exact episode number in detail.
Do not infer episode offsets or substitute an episode. Catalogue releaseDate
is not used as premiere year for this route because it can be the upload date.
Normal season and movie year checks remain unchanged. Cache verified mappings.

Live discovery observations: TMDB 33238 has one regular season with 828 episodes;
KissKH search has Running Man id 535 with 825 episodes; detail contains episode
821 id 224468. Its releaseDate is 2021, while TMDB premiere is 2010.
No title, show ID or episode ID is hardcoded into production code.

Validation: 62 mocked provider regression checks pass; manifest validation
passes for 25 providers. Live video playback still requires device testing.
