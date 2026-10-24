# Mapple v2.0.1 — faster PoW hashing

Apply ZIP at Cloudbank root beside existing manifest.json and refresh to Mapple v2.0.1. No VUEO app patch or provider deletion.

User device v2.0.0 reached website, UI session and media session with HTTP 200, then exhausted its 8s PoW budget without requesting any video source. Subtitle lookup was successful but not the cause of the missing video.

v2.0.1 replaces per-nonce CryptoJS hasher allocation with dedicated SHA-256 compression over challenge UTF-8 bytes plus decimal nonce. Constant full challenge blocks are hashed once; state, message schedule and tail buffers are reused. SHA-256 output and protocol remain unchanged. Work still yields between short chunks and the PoW maximum remains 8 seconds within the existing scan deadline. Difficulty, attempts and elapsed time are logged for both success and timeout. No fake proof, bypass, cached token, protocol change or increased timeout. Current API/session/host/caption logic remains as v2.0.0.

Validation: 112 independent challenge/nonce digest comparisons against Node SHA-256, including Unicode and block/padding/digit-length boundaries, pass. Existing full provider workflow test with host modules blocked also passes. A previously captured real server difficulty-18 challenge was solved offline in 286337 attempts / 482ms in the Node VM and independently verified; this was not resubmitted to a server. Benchmarks in two runs: 10000 hashes took 20–23ms versus 66–68ms using the previous implementation. These numbers are not Android VUEO speed measurements. Syntax and repository validation pass.

Run node tests/mapple-current.cjs at repo root. Optional MAPPLE_POW_FIXTURE may point to a private previously captured server JSON for an offline challenge check; no captured tokens/challenges or media URLs are bundled.

Retest Animals TMDB 1236045 on VUEO. Look for POW solved and media-session-proof HTTP status, then encrypt/source/playlist stages. Successful Android PoW and playback remain to be confirmed.
