Extract over Cloudbank repository root. No VUEO changes.

Mobile and H5 exact title selection: one eligible catalogue ID ignores year;
multiple eligible IDs require one uniquely matching year. H5 copies of the same
ID across mirrors remain one candidate. Exact title/type/audio checks retained.
No arbitrary first result when multiple IDs remain ambiguous. Mobile search
logs title/type/audio rejection counts plus exact candidates/year matches.
No auth tokens or signed playback URLs added to diagnostic logs.

Existing API routes, stream probes, audio preference, captions, fallback H5
hosts and WebView are unchanged. No added requests. This is a selection fix,
not a decoder/playback or latency rewrite. Does not claim the example movie
is actually in the catalogue; new rejection logs will distinguish the cause.

52 regression checks pass including mobile/H5 year policy and existing resource
validation. Manifest validates 25 providers. Live catalogue match and Android
playback require testing. No YAML files. Other provider versions preserved.
