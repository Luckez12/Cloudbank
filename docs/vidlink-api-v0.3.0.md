# VidLink API Test v0.3.0

Apply the ZIP at the Cloudbank repository root, refresh VUEO's repository, and select VidLink API Test v0.3.0. This replaces the prior HTTP/WebView Test under its existing ID. Original VidLink is unchanged. No app patch or YML.

Restores the API route that already produced candidates on the user's phone. No WebView, title search, metadata HTTP request, external token service or subtitle HTTP requests. Captions already in the API response are forwarded.

Observed on 2026-10-17: original VidLink's rendered Masterplan player selected its 360p MP4 first. Previous tests selected 1080p first and stopped at that file's HTTP 428. This bounded test uses the site's first numeric quality key, then at most one other quality (highest remaining). HLS remains preferred when supplied. This is not a permanent recommendation to limit playback to 360p.

At most one API request plus two GET media checks; stop after first accessible media. One failed file no longer rules out every file. HTTP 429 stops immediately. Uses the same approved site proxy URL mapping and separate upstream header payload. HLS requires playlist text; MP4 requires video/mp4 and a plausible full resource size. HTML and failed HTTP responses are rejected. Captured URLs are not returned without checks.

Identity: exact requested TMDB/type/season/episode route; rejects conflicting response metadata wherever supplied. The observed Masterplan API response does not echo a content title or TMDB identity. Correct UI metadata is not evidence of correct video content. Incorrect upstream content is not claimed fixed.

Validation: routing/selection/header/transport regression tests passed; Cloudbank validator passed for 54 providers. Browser inspection showed the original page's Masterplan player and 360p media URL, but no confirmed playback. Development-network GET checks for both 360p and 1080p returned HTTP 403 text/plain (Your request was blocked). User previously received proxy HTTP 428 on 1080p. Live recovery remains unverified. This patch tests a specific file-selection difference, not a confirmed Cloudflare workaround.
