# HDHub4u 2.1.2

WATCH correction: read the literal links object in the unpacked player script and select the first declared delivery in hls4, hls3, hls2 order. Resolve relative URLs against the player page and accept API-declared HLS .txt routes. The previous generic URL scanner skipped relative hls4 and .txt hls3, selecting absolute hls2 instead. Generic extraction is retained when no supported literal links object is present.

Subtitle correction: parse unpacked WATCH script tracks in addition to original HTML. English/Malay only; thumbnail tracks excluded. No subtitle/media requests added.

Website inspection: the Moana WATCH page declares hls4 || hls3 || hls2, English captions in its packed JWPlayer setup, and client-side error/HEAD handling to switch delivery. This patch matches the initial delivery preference; it does not reproduce the website runtime error switching or HEAD probes inside VUEO.

Performance log 14:08: initial frame at 5.360s, buffering at 17.695s, then switching sources; next source first frame 2.725s and later buffering 0.717s following seek. Both sessions receive/configure English subtitles and deliver subtitle cues. No media URL/HTTP segment diagnostics are present, so exact network failure cannot be identified.

Tests: simple flow; parallel/failure isolation and PLAYER-2 ordering; WATCH relative hls4/.txt hls3/packed captions; 25-provider validation. No device playback validation or guaranteed buffering fix. VUEO unchanged. Parallel WATCH + PLAYER-2 and supported server labels retained.
