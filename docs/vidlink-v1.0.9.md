# VidLink v1.0.9 — enable generic MSE/blob readiness

1. Apply APP-VUEO-WebView-Blob-Readiness-v3-TV-Mobile-No-YML.zip at the app repository root. Build with the existing GitHub workflow and install the resulting app.
2. Apply this ZIP at the Cloudbank repository root and refresh the repository in VUEO. Select VidLink v1.0.9.
3. Repeat the same movie or episode. Inspect SESSION, READINESS and HANDOFF_CHECK log lines.

The provider enables allowBlobMediaReady on its existing single WebView. It logs the companion capability and an allowlisted readiness basis. Exact ID routing, local token, API identity checks, native observed request requirement, session headers, bounded final HTTP validation, captions forwarding and request counts remain unchanged. No added HTTP, retry, subtitle request or timeout extension. An old companion app can still handle a direct HTTP video URL but cannot resolve the newly supported MSE readiness path.

Expected next stage when blob correlation qualifies: mediaReady=true and READINESS: blobSupport=true basis=blob-single-network, then one native HTTP handoff check. This does not promise successful playback. If HTTP access is still blocked, expect HANDOFF_CHECK: HTTP 428 and zero sources. If there is no unique eligible observed HTTP request matching the API identity, no native source is returned. The code does not fabricate an HLS master from an MP4 or return blob URLs.

Hook/provider unit tests passed and Cloudbank validation must pass before packaging. Full Android build and playback are not verified in this environment. No separate test provider or YML is included.
