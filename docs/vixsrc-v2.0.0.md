# VixSrc v2.0.0 — current website HTTP flow

Apply the ZIP at the Cloudbank repository root, overwrite matching files, then follow DELETE_FILES.md. Refresh the repository/provider in VUEO. No VUEO app patch or workflow changes are required.

## Resulting behavior

- Request the exact movie or TV episode `/api/movie/{tmdb}` or `/api/tv/{tmdb}/{season}/{episode}` route used by the current website frontend.
- Resolve its mapped, same-origin `/embed/{websiteVideoId}` URL. This internal video ID differs from TMDB by design; it comes from the exact requested API response.
- Parse the named inline masterPlaylist assignment without evaluating website JavaScript. Carry the non-empty signed parameters, including optional parameters such as asn, and reproduce the current player's h=1 and lang construction. Default lang=en follows the website player and is a preference, not verified original-audio evidence.
- Return one adaptive master with its playback Referer/Origin. Preserve all resolutions and audio options. Audio is unverified/unknown and accepted.
- Two HTTP reads only. No separate master check, child/segment requests, variant splitting, minimum-resolution filtering, external subtitles, metadata network request, dead custom-domain fallback, redundant outer-page fallback, signed URL cache or WebView.
- Fail immediately on an API/embed error; do not disguise HTTP 403 as a usable source. This change does not guarantee that all requests or networks will be accepted by the website.

## Evidence and limits

On 2026-10-22, the current public frontend JavaScript used the exact API route above. A live HTTP audit received API 200, mapped embed 200 and master 200 with an HLS response containing 1080p, 720p and 480p variants and English/Italian audio for the audited movie. The master check alone took approximately 8 seconds in the development environment and is deliberately absent from production discovery. This is not a device timing estimate.

The rebuilt parser passed against the captured actual embed HTML. Regression tests verify exact movie/episode routing, two reads, signed parameter/header preservation, adaptive output, API/embed HTTP errors and incomplete/expired/wrong-route payload rejection. `npm run validate` passes with 36 providers.

Android playback and real search timing remain unverified until device testing. No title, ID or device-specific cases were added.
