Cloudbank 1.20.69 — VidRock 2.1.0 fast collection

Apply with the existing Cloudbank patch workflow. This ZIP contains the manifest, VidRock provider, two regression tests and these notes. No YML, delete script or VUEO application change.

Why 2.0.0 waited
The supplied device log resolved Luna at approximately 6.6 seconds but continued waiting for Orion until about 13.3 seconds before returning the whole batch. Route fetching was already parallel. The delay was waiting for the slower alternative.

Change
After the first source passes every existing media/quality/audio check, collect alternatives for at most another 1500ms. Return sooner if all routes finish or three sources are ready. Keep any alternative which completes within that window. Slow alternatives may be omitted, so this can return one playable source instead of two. A failed, unverified or HTML/image source never starts that window. If no source is ready, existing per-request limits and the 17.5 second total deadline still apply. Completed sources are retained if the total deadline expires.

Playback paths unchanged
Authenticated AES-GCM URL decoding, HLS MIME, website request headers, 720p+ rendition selection, native TS/PES or MP4 text-prefix checks, binary/SPS checks when available, audio-label policy and display formatting are retained. No title, TMDB ID, language, device or CDN-server exception was added. First-source selection follows validated completion order; a slower higher-quality alternative may therefore be omitted. Audio labels remain API evidence rather than confirmed audio tracks.

Pending work is stopped in JavaScript, its timers are cleared and it cannot start retries, append sources or emit provider logs after completion. Fetch abort is attempted where AbortController is supported; existing text-only native HTTP cancellation depends on the VUEO runtime. No playback-token cache was added. Existing public-key cache and key-rotation checks remain.

Diagnostics
DISCOVERY logs key-cache hit/miss and elapsed time. FIRST_SOURCE logs when the first validated source becomes ready. TIMING logs firstSourceMs, preHostMs, hostMs, totalMs, peakRoutes and collection finish reason.

Validation
- npm run validate: 41 providers.
- node --check providers/vidrock.js.
- node tests/vidrock-website.cjs: existing crypto, routing, MIME, redirects, quality, native fallback, payload rejection and audio regressions pass.
- node tests/vidrock-latency.cjs: deterministic virtual-time tests cover a slow alternative, timely alternatives retained, invalid first segment, failed/hung routes, full deadline, completed-source retention, timer cleanup and late native responses.
- Replaying a synthetic schedule based on the supplied log: v2.0.0 returned 2 sources in 13077ms; v2.1.0 returned 1 source in 8132ms (38% faster). A second source ready at 7500ms was retained and both returned at 7500ms. This is a controlled timing comparison, not a measurement or speed guarantee on the phone. The user confirmed playback of both sources on v2.0.0; v2.1.0 needs a device search/playback test.

Deletion queue
NetMirror and Peachify remain pending deletion and remain in the manifest. Neither is deleted by this patch.
