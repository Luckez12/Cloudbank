# VidSrc.to 1.0.0

Apply at repository root over Cloudbank-main (7). Manifest version 1.20.29. No YAML or VUEO app file changes. ZxcStream is not included. Existing VidSrc provider is preserved: its domains differ from VidSrc.to.

## Verified observations

On 2026-10-17 the official https://vidsrc.to/ documentation describes TMDB movie and exact TV episode embeds. Live HTTP fetches returned 200 for /embed/movie/157336 and /embed/tv/1399/1/1. Their iframes pointed to https://vsembed.ru/embed/movie/157336/ and https://vsembed.ru/embed/tv/1399/1-1 respectively. Direct requests to that player returned a Cloudflare Attention Required page with HTTP 403. No playable HLS was obtained in this environment.

The VUEO-NEXT-main (52) source was inspected: shared/core/src/main/java/com/vueo/shared/core/plugin/PluginWebViewResolver.kt enables JavaScript, DOM storage, first- and third-party cookies, direct WebView navigation, autoplay and passive network capture. It reads CookieManager cookies into captured playback headers and preserves User-Agent. Its maximum session duration is 12 seconds. PluginRuntime.kt exposes this through globalThis.webviewResolve.

## Implemented flow

1. Validate numeric TMDB ID and movie/TV input. Require exact season/episode for TV; preserve season zero.
2. Open the documented VidSrc.to embed URL in one native WebView session. Let the website load its actual iframe; no hardcoded replacement host, external resolver, guessed API, metadata HTTP request, fuzzy title search or preliminary HTML fetch.
3. Capture observed .m3u8 candidates with their playback headers. Prefer an observed master-named URL. Verify at most two observed candidates with 1.8-second checks. Reject HTML, errors and non-playlist bodies. Return immediately after a valid HLS playlist, keeping the original master URL when captured. No variant expansion, segment probe or signed-link cache.

The WebView session is capped at 12 seconds; a 12.5-second outer wait guard and two 1.8-second verification guards keep the provider within the 20-second runtime budget when the native resolver starts promptly. VUEO serializes WebView sessions; contention can consume the available runtime. JavaScript wait guards do not cancel native work. Captured session cookies are passed only as playback headers, never printed in logs.

## Limits

This uses VUEO's existing browser session capabilities; it does not implement a universal Cloudflare bypass, CAPTCHA solver, fingerprint spoofing or challenge UI. Cloudflare may reject Android WebView or its network location. A challenge that requires manual interaction cannot be completed by this hidden resolver. No claim is made that Cloudflare has been passed.

This first release handles captured .m3u8 HLS URLs only; extensionless media and MP4 are unsupported. Standalone subtitles are not extracted. HLS subtitle references remain inside the original playlist. Quality is Auto rather than an invented resolution. Exact requested routing is not proof of audiovisual title or episode identity; successful playlist validation is not proof of segment access, decryption or end-to-end playback. Android TV/mobile playback remains unverified.

## Checks

`node tests/vidsrc-to.cjs` passed fixture checks for movie/TV/special routes, invalid inputs, missing/failed resolver, duplicate filtering, master preference, early exit, HTML rejection, observed fallback, and Cookie/User-Agent/Referer preservation. `npm run validate` passed for all 53 providers after installing the repository's locked dev dependencies.
