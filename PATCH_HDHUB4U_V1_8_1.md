# HDHub4u 1.8.1

Apply at repository root and refresh provider. Includes the 1.8.0 host-flow and request lifecycle changes. No YAML or VUEO modifications.

User-authorized change: remove both unconditional R2 rejection points (verifyDirect and HubCloud acceptance). Direct R2 files now pass the same media and nonzero byte-range verification as other hosts. HTML, failed responses and ignored seek ranges are still rejected. This does not establish on-device seek correctness; test playback, seek forward/back and resume on the affected movie TMDB 969681.

Tests: new R2 valid-media/nonzero-range acceptance and ignored-range/HTML rejection pass; host-flow, fast path and polish tests pass. Repository validation passes for 25 providers. No Android playback/seek success is claimed.
