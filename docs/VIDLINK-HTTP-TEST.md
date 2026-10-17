# VidLink HTTP Test 0.1.1 — GET probe

Apply at Cloudbank root, refresh the repo in VUEO, and retry Masterplan (TMDB 1561726) using VidLink HTTP Test. Original VidLink is unchanged. No VUEO app or YAML edits.

User-device v0.1.0 evidence: local token/API request completed in approximately 528ms. The subsequent MP4 HEAD request to the authorized site proxy returned HTTP 428. This does not establish whether the server will reject playback GET, and it does not prove a Cloudflare challenge caused the response.

v0.1.1 replaces HEAD with a single GET carrying Range: bytes=0-1023. This replaces rather than adds a check. Accept a valid 206 starting at zero with substantial Content-Range total, or 200 video/mp4 with adequate Content-Length. HTML/JSON and errors remain rejected. The Range probe header is removed from the returned playback headers so playback is not limited to 1024 bytes.

VUEO's existing PluginHttp.executeJson skips video/audio bodies and bounds textual bodies, as confirmed in the supplied app source. This avoids copying the movie into provider memory even if the server ignores Range. No app change is required for that existing behavior.

Local token generation, exact TMDB/season/episode routing, source headers and the user-authorized flood.sourcerrr.online site-proxy mapping remain unchanged. No WebView, external token-service request, title/metadata request or subtitle-download request is added. Existing API caption rows are forwarded without cue-validation requests.

Checks: isolated fixtures passed for GET/206 Content-Range totals, rejection of nonzero ranges, 200 media fallback, no probe Range in playback headers, local-token crypto, exact routes and mismatch guards. Full Cloudbank validation passed for 54 providers. Development-network proxy GET tests previously returned 403; recovery of the user's device-specific 428 is not yet established. This is a targeted on-device test update, not a guarantee that GET resolves the failure.

TweetNaCl.js 1.0.3 is public-domain/Unlicense (bundled). Protocol references: https://vidlink.pro/ and its public assets; token-format cross-check https://github.com/walterwhite-69/Vidlink.pro-Decryptor .
