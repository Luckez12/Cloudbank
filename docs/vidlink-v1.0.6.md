# VidLink v1.0.6 — original provider media handoff correction

Apply at Cloudbank repository root. Refresh the repository in VUEO, confirm VidLink v1.0.6, and test Tenzing TMDB 1288069. The provider ID and name remain VidLink; no test provider or app patch is added. No YML.

Changes:
- Current API request includes multiLang=0 and X-Playback-Environment=hls.
- Locally generate the public-ID token instead of fetching enc-dec.app. Exact movie/TV/season/episode route, no title search and no metadata HTTP request.
- Honor requiresProxy with VidLink's observed flood.sourcerrr.online /mp or /proxy mapping. Upstream headers are encoded in the proxy request as the site does. Playback headers for the proxy use VidLink origin/referer. Direct sources keep their own headers.
- Preserve MP4 quality options. Prefer a supplied HLS playlist per server without inventing a master or deriving new URLs.
- Captions already supplied by the API are forwarded; no subtitle discovery or verification requests.
- Reject response identity/episode conflicts where explicit fields exist. Existing display formatter retained. API response metadata absence does not establish audiovisual identity.

Evidence and limits:
The old v1.0.5 code returned direct CDN URLs and generic VidLink headers even when the response required the site's proxy. This patch corrects that concrete handoff mismatch. The user's phone browser plays Tenzing, while original VUEO playback reports ERROR_CODE_IO_BAD_HTTP_STATUS (2004). That log does not expose the exact failing HTTP status. Earlier separate tests through the site proxy received 428. Therefore the handoff correction is not a demonstrated solution to proxy rejection; native playback remains unverified.

This provider performs one API request and returns API candidates to the player, like the original discovery flow. It does not probe media URLs or label accessibility as verified. Links found is not proof of playback. Cookies or browser transport requirements may still prevent native playback; this patch does not bypass or solve those controls.

Validation: one-request routing/token/proxy/header/media-selection/identity-conflict regression tests passed. Independent TweetNaCl token decoding passed. Cloudbank validator passed for 53 providers. No Android build required because only provider/manifest files change. Device playback must still be confirmed.
