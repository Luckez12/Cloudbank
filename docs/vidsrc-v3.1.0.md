# VidSrc v3.1.0 — one website session, direct media handoff

The v3.0.1 device log confirms `HTTP 403 invalid-api-token` at the stream API before any WASM/binary request. Website-style headers did not make native token replay reliable. The earlier manual HTTP 200 responses established only intermittent API access; they did not establish a reliable provider route.

This version removes the native HTTP token/API/decoder flow. It opens one exact website embed route and lets that session handle its own iframe bootstrap, token, verification and decoder. There is no native HTTP-first attempt or stacked browser fallback.

The user's earlier v2.0.1 device log contained one HLS candidate in the basic resolver result. That candidate was discarded only after a separate 1.8-second native GET timed out. This version directly returns eligible basic resolver candidates without requiring omitted observation flags and without that extra request. If detailed flags are present, explicit unobserved candidates remain rejected. HTML, blob, segment/init/trailer/preview/sample URLs and duplicates are excluded. Captured headers are preserved except transport headers and Range. HLS is handed off unchanged with Auto/adaptive MIME; no child playlist, segment or subtitle request is added. Captured output is not labeled validated playback.

The previous basic/detailed contract bug is not reintroduced: missing diagnostics are printed as not-provided, not false. Unknown audio is accepted; only explicitly labeled dub-only candidates are rejected. No independent audio verification occurs.

The browser request has a 10-second ceiling and a 300 ms first-candidate finish delay. Discovery can finish earlier, but no device speed improvement is claimed. Website verification can still prevent capture. HLS capture does not prove that native playback can fetch its segments or retain any browser-bound session; device playback testing remains necessary. This is a bounded attempt to hand off the HLS already seen in device logs, not a confirmed playback fix.

Regression fixtures reproduce the actual basic result shape (URL, label, headers, no observation flags), verify direct master/header handoff, zero native HTTP/binary calls, detailed false-flag rejection, exact episode routes, invalid requests and empty sessions. Validation passes for 36 providers.

Manifest v1.20.79, VidSrc v3.1.0. Cloudbank-only patch. No VUEO update or binary capability is needed by this version; the existing generic binary support can remain for other providers. Delete instructions retain UHDMovies, VegaMovies and VidEasy. VidLink remains deferred.
