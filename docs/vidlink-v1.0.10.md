# VidLink v1.0.10 — verify observed media without browser-ready gate

Apply at Cloudbank repository root and refresh VidLink. No YML or separate test provider is included. Cloudbank version 1.20.42.

This provider works with the previously installed v3 companion app: a matching native-observed candidate is now HTTP-checked even if the WebView times out and reports mediaReady=false. To remove that readiness wait, also apply/build/install APP-VUEO-WebView-Network-Handoff-v4-TV-Mobile-No-YML.zip. That app ends the existing session after observing a matching request, using the existing 250ms settling delay. It does not wait for browser video playback.

API exact-ID route, local token, API media path/upstream host correlation, observed native network requirement and session-header forwarding remain. Candidate URLs seen only in JavaScript, wrong files/upstream hosts and blob URLs cannot be returned. No title search, retry, second WebView or subtitle request is added. There is at most one bounded media HTTP check, now reachable without browser readiness. An unsupported older app still requires the session-handoff v1 capability.

Safe diagnostics:
- CANDIDATES: nativeObserved, apiMatched and earlyStopSupport.
- HANDOFF_CHECK: MP4/HLS transport and browserReady flag.
- HANDOFF_HTTP: numeric status and allowlisted content kind (mp4/hls/html/json/other).
- HANDOFF_REJECT: bounded reason for invalid MIME/size/range/playlist.

No cookie, URL/token, response body or free-form header value is added to logs. Existing runtime timeline logging is unchanged. Expected updated-app flow: finish=network-candidate, mediaReady=false may be normal, apiMatched>=1, earlyStopSupport=true, then one HTTP check. On HTTP 428 the result is still zero, with the actual status visible. Capturing a URL, returning a source, and native player playback remain different outcomes.

Validation: mock tests passed for ready=false/timeout candidate checks, old-companion compatibility, exact API route/upstream matching, JS-only/unmatched/blob rejection, 428/HTML rejection, one API/session/probe and private-value omission. Actual injected hook regressions passed; Cloudbank validation passed for 53 providers. Native Android compilation and phone playback remain unverified in this environment.
