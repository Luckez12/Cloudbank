# Vidnest v2.2.0 — bounded collection after first usable source

Extract ZIP contents directly at the Cloudbank repository root, beside existing manifest.json. Refresh to Vidnest v2.2.0. No app/workflow/dependency change or deletion. All video checks, authenticated decoder, actual playback URLs/headers, English/Malay filtering and original subtitle labels are retained.

User device log for TMDB 1236045: source captions v1 ready 1447ms; HLS root and MKV HEAD ready 1593/1668ms. Top-level Promise.all kept the scan open until the slow FlixHQ route timed out around 10s. Subtitle v2 was also still active. The same session recorded first video frame and delivered subtitle cues. This confirms that sample, not all titles.

New scheduling: each verified source enters the result set as soon as ready; no wait for a sibling candidate. First source starts one 600ms collection window. Finish earlier when at least two sources and both English/Malay external captions are ready, or when all source routes and subtitle work have settled. Keep API bounds up to 10s and total 16s deadline only while no eligible source has arrived. A lone usable source is returned after its 600ms grace even if other calls ignore abort. Finished sources retain original server ordering. Slower additional sources may intentionally be omitted.

Subtitle v1/v2 still start alongside video but stop immediately when both requested languages have arrived. Source completion snapshots available subtitles; no await of a subtitle Promise after collection. Slow/late captions may therefore be omitted if not ready within the source collection window; no deferred caption mechanism or player reset. If no sources are found, subtitle work is stopped. The 3.5s subtitle cap remains a maximum while discovery is active.

Finish aborts available HTTP controllers, rejects remaining local HTTP waits to clear timers, clears collection/total/subtitle timers, and ignores late source/caption results. This does not require native transport to acknowledge abort in order for JavaScript to return partial results. Existing VUEO execution teardown owns native request cleanup.

Regression validation: syntax check and npm run validate pass for all 36 providers. 32 protocol/workflow checks pass. Added reproduction keeps FlixHQ and subtitle v2 permanently pending while fast routes and v1 captions complete: two sources with EN/MS are returned promptly and pending signals aborted. A separate single-source test retains the source with the other calls indefinitely pending and returns after approximately 602ms in Node. Existing authenticated crypto, language, source-label, header/query, episode routing and subtitle-failure tests still pass. Run node tests/vidnest-v2.cjs at repository root. No real Android scan-time improvement is claimed until tested on device.

Retest the same TMDB 1236045 and compare TIMING firstSourceMs, totalMs, pendingRoutes and finish reason. Network and server variability still affect discovery speed.
