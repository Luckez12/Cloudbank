# HDHub4u 2.1.1

Two corrections to 2.1.0:
- Emit `server` as well as `serverName`. VUEO PluginRuntimeParsing reads server/extractor/host/embedder, not serverName. Source cards can now show WATCH or PLAYER-2 without modifying VUEO.
- PLAYER-2 follows API streamingConfig order and adjustments (disabled entries, params, /hls/ domain routing), selecting the first available configured delivery. 2.1.0 always selected source (In-House), ignoring website delivery preferences. API-designated HLS delivery may use a .txt playlist URL; MIME remains HLS.

WATCH extraction and headers remain unchanged. WATCH and PLAYER-2 still start concurrently, with one request each, a 4s request limit and existing total deadline. No new playlist, segment, subtitle or seek probes. English/Malay filter retained.

Evidence from uploaded performance log: initial session first frame 3.083s; later attempt restarts at 7.295s and first frame 14.247s; repeated subsequent buffer waits 2.219, 6.087 and 6.292s. Another session first frame 8.422s. No explicit HTTP/player error or URL-to-server mapping is recorded, so the failing server and retry cause cannot be conclusively assigned. Scan count is zero during these playback samples. EN subtitle cues were delivered.

Validation: original simple-flow suite; parallel start and isolated failure suite; encrypted API; server metadata; delivery order/disabled/URL adjustments; all 25 providers validate. Playback improvement is not yet verified on device. These changes fix confirmed provider errors, not a proven diagnosis of every buffering event.
