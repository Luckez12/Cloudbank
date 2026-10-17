# VidLink HTTP Test 0.1.0

Apply to Cloudbank root and refresh the repository in VUEO. Select the new VidLink HTTP Test provider for Masterplan (TMDB 1561726), matching the user's successful original-site browser test. Existing VidLink and VidSrc.to 1.0.2 descriptors are unchanged. No app changes or YAML files.

Purpose: determine whether native HTTP on the user's device can access the current VidLink site's source/proxy flow. This is an on-device test provider, not a playback-verified replacement for VidLink.

Flow: exact TMDB movie/season/episode route, local public-ID token, one source API call with X-Playback-Environment: hls. No WebView, title search, TMDB detail call, external token service or subtitle-download request. Existing API caption rows are forwarded with their own headers. Caption availability, correctness and cue timing are unverified.

For sources marked requiresProxy, use the same flood.sourcerrr.online transformation observed in the site's current JavaScript. The user explicitly authorized testing this destination and forwarding the source media tokens/headers on 2026-10-17 after the automatic approval block was explained. Only the fixed site-proxy destination is configured. Source headers are serialized for the proxy's upstream request; VidLink Origin/Referer identify the frontend proxy request. They are not mixed into the CDN's own header object.

Prefer a returned HLS playlist and stop the same server after a valid master. If no valid HLS, check the highest available MP4 via HEAD (avoids downloading a large movie if Range is ignored). Require success, video/mp4 and substantial Content-Length. HEAD failure does not prove a browser GET cannot work. This deliberate first-stage check will expose HTTP status in diagnostics rather than returning a known inaccessible URL as healthy. Sources with explicit conflicting identity fields are rejected; no audiovisual identity guarantee is made without actual playback review.

Development-network tests: fresh local tokens received API 200 for movie 1561726 and TV 80539 S1E1. Direct media probes returned 428/426. User-authorized proxy Range GET probes returned 403 for both, while the user confirmed the original VidLink browser player works on their phone. Therefore native-device HTTP access still requires testing; this artifact does not claim the proxy works from development or on Android.

Isolated tests passed: exact movie/TV/special routes, invalid input, independent local-token cryptographic check, no runtime modules/Node/Buffer/WASM required, HLS preference/early stop, identity conflict rejection, HTML/null handling, proxy URL encoding/header separation and no extra caption fetches. Full Cloudbank validation passed for 54 providers.

No playback app hardcoding is introduced. The proxy may be blocked on the user's device too; if so the next decision must be based on its actual HTTP status. The approved proxy can see media access tokens/source headers exactly as required by this flow.

Embedded TweetNaCl.js 1.0.3 is public domain/Unlicense; license bundled. Protocol checked against https://vidlink.pro/ and its public page assets; token format cross-checked against https://github.com/walterwhite-69/Vidlink.pro-Decryptor .
