# VidSrc v3.2.1 — post-player stage investigation

The latest device log proves Play was clicked and the real player iframe was requested. It records only two DOM-ready frames, one API request and no HLS. Those observations do not establish whether the player document began executing, whether its parser/DOM finished, whether verification completed or whether the stream API ran. The one API request can be poster metadata.

The website's player code waits for `vs:verified` before booting when verification is enabled. Its `vs:playerready` event can also fire for a displayed error; it is logged as playerSignal, not successful playback. A parser-blocking script precedes the main player libraries. The downloaded script was roughly 640 KiB, but its presence does not prove it caused the device timeout.

A direct cloud-browser inspection of the exact route navigated to about:blank and logged the site's `You don't have permission to use DEVTOOL!` warning. Investigation in that browser stopped at the client restriction. This does not show that the user's browser or Android WebView suffered the same restriction, and does not justify modifying the site's protection. No protection, fingerprint, verification or token behavior is changed by this patch.

This version requests generic diagnostics v2 from the separate VUEO patch. It reports player document creation, DOM readiness, window load/unload, script load/error counts, runtime errors, observed verification/UI events, stream-query requests separately from metadata, verify/WASM request counts and HTTP errors, and a provider-selected console-signal counter. Only counters and configured labels are returned; no raw console messages, script source URLs, token values, IPs or page content are logged.

FRAME_PLAYER created>0 with domReady=0 indicates the observation script began before the document reached DOM readiness. PLAYER_STAGES verified=0 means the success event was not observed, not proof of a failed challenge. streamRequests=0 means no request carrying the configured stream_urls key was observed. clientRestrictionSignals>0 records the site's warning in this WebView session. Each narrows the stage; none alone proves a root cause.

This is a diagnostic revision, not a confirmed playback repair. The existing Play behavior, 12-second ceiling, unchanged master HLS handoff and absence of separate native API/media probes remain. Website verification stays intact. Both the separately packaged VUEO diagnostics v2 update and this provider are needed for the new observations.

Validation and provider regression fixtures pass for 36 providers. Frame-script tests cover creation before readiness, separate frame contexts, late Play, verification/UI events, script/runtime errors, real document-load event targeting, unload, cleanup and content-free messages. The modified full resolver and session policy compile against Android API 35 and WebKit 1.14.0. Full APK, device playback and speed are unverified.

Manifest v1.20.81. The existing delete instructions retain UHDMovies, VegaMovies and VidEasy; VidLink remains deferred. Existing generic binary support is unrelated and is not changed.
