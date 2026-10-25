# HDHub4u 1.9.1 — restore temporary R2 direct exclusion; retain HLS alternative

Apply at repository root, refresh VUEO and verify provider 1.9.1. No YAML or VUEO changes. Includes previous provider fixes. Manifest retains 4KHDHub 2.0.4 and authorized CineVibe/CineMode removal.

Device evidence: three source IDs from 1.9.0 match the files with repeated seek-to-zero in the supplied performance ZIP. All three direct files came from the same R2 bucket and passed byte-range probes. User authorized restoring the exclusion as a temporary avoidance policy, not a diagnosis of every R2 file or proof the server ignores Range.

Block direct r2.cloudflarestorage.com/r2.dev URLs before needless probes and reject redirected final direct R2 responses. HubCloud continues to other eligible mirrors. HLS with a validated playlist is not rejected merely because its hostname belongs to R2; it uses the existing HLS checks. This cannot repair seek indexes inside a remote media file.

Collector allows at most two results from each exact hostname, reserves a slot for successfully resolved HLS, and no longer stops at three direct results while site tasks are pending. The 9.5s collection and 3.5s post-first ceilings still apply, within the overall provider budget. HLS may still fail or miss the deadline; never fabricate a source or wait indefinitely. Fewer than three results or none may be returned if only blocked/dead mirrors exist. 1080 H264 release preference and adaptive Auto remain.

Tests pass: delayed WATCH after fast same-host file results, two-per-host limit, R2 exclusion, stalled WATCH partial results, direct/redirected R2 rejection, non-R2 seek checks, existing alternatives/quality/host-flow/fast/polish tests. Repository validates 25 providers. Playback and real seek on the next returned HLS/other host still require device testing. Test TMDB 969681 and send provider plus seek log if it resets again.
