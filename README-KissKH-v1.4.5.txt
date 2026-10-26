KissKH v1.4.5 provider patch. Extract over repository root.

Fixes v1.4.4's mistaken dependence on full TMDB seasons metadata: VUEO
returns a reduced metadata body without seasons. No TMDB numbering request
is made now. No VUEO changes, subtitle changes or provider-specific app rules.

Flow: exact title search -> one matching detail -> exact website episode ID
-> parallel video/subtitle API calls. Explicit requested seasons take priority.
If no explicit season matches, only one exact unlabelled catalogue with no
season-labelled siblings in the search response can use its episode numbering.
Requested later-season E1 is not substituted. Missing/duplicate exact episode,
wrong explicit season, different title, or ambiguous catalogue yields no source.
There is no episode offset. This catalogue route does not establish requested
season identity; it follows the site's exact episode number. It cannot prove
season equivalence when the site provides no season data. Cache namespace
bumped to invalidate old mappings. Existing EN/MS subtitles remain unchanged.

65 regression checks and 25-provider manifest validation pass.
Real Running Man search/detail responses were replayed through the provider
with VUEO's reduced metadata shape: S17 E821 selected website drama 535 /
episode 224468 using four discovery calls and no TMDB request. Video/subtitle
responses in replay were mocked; actual device playback remains untested.
