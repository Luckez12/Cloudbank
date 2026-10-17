# VidLink v1.0.8 — WebView state diagnostics

Install the app built with the companion WebView state diagnostics v2 patch first. Apply this ZIP at Cloudbank repository root and refresh the repository in VUEO. Select VidLink v1.0.8 and run Tenzing TMDB 1288069 once.

The only provider behavior added is logging scalar fields returned by the same WebView session. Version/manifest notes are updated. API request, local token, source correlation, WebView timeout (12s), readiness gate and final HTTP check are unchanged. There is no extra HTTP, retry, subtitle fetch or new provider. An old companion app remains supported but logs that the diagnostic update is missing.

Relevant raw-log lines:
WEBVIEW_STATE: hook=... pageFinished=... pageHTTP=... mediaHTTP=... pageNetError=... mediaNetError=... mseObserved=... blobObserved=...
VIDEO_STATE: count=... readyState=... networkState=... errorCode=... paused=... sourceKind=... pageSignal=... visibility=...

readyState: -1 unknown/no video, 0 no media information, 1 metadata only, 2 current frame data, 3 future data, 4 enough data. networkState: -1 unknown/no video, 0 empty, 1 idle, 2 loading, 3 no usable source. errorCode: 0 no observed media error, 1 aborted, 2 network, 3 decode, 4 unsupported source. HTTP status 0 means no error callback was observed. These values describe observed state, not a guaranteed root cause.

Cookie/token/URL values and free-form page/error text are not logged. Returned classifications and numeric values are allowlisted again by the provider. This update gathers evidence; it is not a playback fix.
