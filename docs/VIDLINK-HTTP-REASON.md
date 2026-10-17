# VidLink HTTP Test 0.1.2 — response evidence

Apply at Cloudbank root, refresh, retry the same Masterplan request using VidLink HTTP Test and read HTTP_FAILURE / HTTP_REASON log lines. No app or YAML changes. Existing VidLink remains unchanged.

The user's v0.1.1 evidence confirms local-token/API success (~0.4s) and a GET MP4 check returning 428 through the configured site proxy. HEAD is therefore not the sole cause. A status number alone does not establish whether a challenge, missing precondition, proxy rule or upstream error caused the response.

This update reads the body of the already-failed response and selected headers (content-type, server, cf-mitigated, x-error-code, x-proxy-error, x-upstream-status). It adds zero HTTP calls, no retry, no WebView, and no new destination. For JSON it logs only primitive error/message/code/detail fields; HTML only title/H1; plain text is bounded. URLs, common token/cookie fields, long encoded values and IPv4 addresses are redacted before logging. This is targeted diagnosis, not a claimed playback fix.

GET Range probing, local token, exact routes and the authorized site-proxy mapping are unchanged. Probe headers are not forwarded into playback. Existing VUEO reads the failed textual response already; response.text() here accesses that cached response text and does not perform another HTTP request.

Isolated tests passed for redacted error evidence and exactly two network requests, plus prior route/crypto/GET range/proxy/mismatch guards. Full Cloudbank validation passed for 54 providers. Live 428 reason is unknown until the user's response evidence is available. Do not infer Cloudflare from a generic server header alone.

TweetNaCl license bundled; current-protocol reference https://vidlink.pro/ .
