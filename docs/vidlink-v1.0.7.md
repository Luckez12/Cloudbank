# VidLink v1.0.7 — companion for VUEO WebView session handoff v1

Apply to Cloudbank only after installing the app built with the companion patch based on app repo 54. Refresh Cloudbank and confirm VidLink v1.0.7. Uses existing VidLink ID/name; no test provider, app hardcoding or YML. Other provider descriptors are unchanged.

Flow: one exact-ID API request with a local public-ID token -> one original VidLink page in WebView -> wait for video data and an observed network request -> correlate that observed media pathname/proxy upstream host with the API candidate -> one HTTP validation outside WebView using captured headers/cookies -> return one source. Browser-observed signatures/URLs are retained; the prior API URL is not substituted back. Captions are reused from the API without subtitle HTTP.

This returns the quality actually observed in the browser session (often the site's initial 360p), not all untested quality URLs. Supplied HLS may only pass when the media currentSrc can be correlated directly; blob/MSE correlation is intentionally unsupported. No fabricated master HLS.

Budget: API up to 4s, WebView up to 12s, one HTTP media check up to 1.8s. No HTTP preflight/retry chain, no polling for subtitles, no repeated browser sessions. Missing companion app, video-not-ready timeout, unmatched media or post-session HTTP rejection returns zero streams with a bounded diagnostic. A post-session HTTP success does not guarantee ExoPlayer playback, since the provider HTTP client and player transport may differ. Upstream audiovisual identity is not established by matching the route alone.

User test: Tenzing TMDB 1288069. Relevant log lines are SESSION: finish=..., mediaReady=..., captured=... and HANDOFF_CHECK: HTTP/status or accessible. A timeout identifies failure to obtain ready video in app WebView. A 428 after mediaReady=true identifies failed HTTP reuse despite browser readiness. Neither is reported as working playback.

Validation: mocked integration tests passed for successful handoff, missing app support, timeout, wrong media, missing observed request, HTML and HTTP 428. Cloudbank validator passed for 53 providers. Android live playback not verified.
