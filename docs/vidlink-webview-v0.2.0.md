# VidLink WebView Test 0.2.0

Apply this ZIP at the Cloudbank repository root, replacing matching files. No YML and no app changes. Refresh the repository in VUEO and select VidLink WebView Test v0.2.0. It replaces the previous HTTP Test under the same provider ID; the original VidLink provider remains unchanged.

Test movie TMDB 1561726 first. Share the resulting provider log and whether the returned source actually plays. Existing native resolver in VUEO repo 53 is sufficient.

Flow: exact `/movie/{TMDB}` or `/tv/{TMDB}/{season}/{episode}` page -> one native WebView -> captured media with session headers/cookies -> up to two bounded GET checks -> first accessible HLS/MP4. Access denial stops further checks. No HTTP API preflight, external token service, title search, subtitle fetches, or HTTP-to-WebView retry chain. Original observed media URLs are retained, including the site's own proxy URLs.

A captured URL is not treated as working media. HLS must contain a playlist; MP4 must return video/mp4 with a plausible full size and valid initial range for HTTP 206. These checks prove transport accessibility only, not audiovisual identity. Routing uses exact requested IDs; incorrect upstream content cannot be ruled out by these checks.

The resolver can capture a URL before playback succeeds. If the post-session GET still returns 428, this test returns zero sources rather than forwarding a blocked URL. No Cloudflare clearance or playback recovery guarantee. Unknown media transports without .m3u8/.mp4 are intentionally skipped in this test.

Validated: mocked routing/headers/transport regression tests and Cloudbank's 54-provider validator. Android live capture and playback remain unverified.
