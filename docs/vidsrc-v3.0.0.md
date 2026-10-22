# VidSrc v3.0.0 — current HTTP-only rebuild

## What changed

The browser implementation and its candidate validation loop have been replaced. The provider now uses the current website's `/vs_src.php` bootstrap directly, obtains the nested player configuration and a fresh website-issued API token, then requests the exact movie or episode stream API. Redirects are manual. Player and API identities are checked before consuming stream data. TV routing was inspected independently: TV uses an exact `/embed/player/tv/{id}/{season}/{episode}` player route and a `streamBase` API configuration.

Encrypted stream lists use the public per-window WASM decoder supplied by the API. Inspection of the current module showed two 32-byte data segments XORed into the ChaCha20 key, a 12-byte nonce and counter zero. The provider reads these data segments and implements that algorithm in JavaScript. It does not execute downloaded WASM, embed a rotating key or depend on a remote decoder service. Unsupported module layouts stop with an error. Public decoder keys may be cached for four minutes, indexed by the website's window value; player/API tokens and signed HLS URLs are never cached.

Returned HLS URLs are passed unchanged with adaptive MIME, Auto quality and the current player Origin/Referer. There is no title search, WebView, manifest check, variant filtering, child playlist request, segment request or subtitle request. Four HTTP calls are required with a cached decoder; five when downloading a decoder. Unknown audio is accepted and remains unverified. HTTP request waits are bounded by a shared 18.3-second deadline and the existing 19-second wrapper budget. This is a maximum, not a demonstrated device performance figure.

## Required generic app capability

The separately supplied VUEO change is only `shared/core/src/main/java/com/vueo/shared/core/plugin/PluginHttp.kt`. A raw native fetch request may opt into `responseEncoding: "base64"`; the native response then has `bodyEncoding: "base64"` and an exact base64 body. The binary body limit is 256 KiB. Existing text behavior, HEAD behavior and video/audio body exclusions remain. A shared encoder function makes the actual response path directly testable. No VidSrc domain, key, title or device rule is present in VUEO. The shared implementation serves both TV and Mobile; the existing mobile delegate needs no change. No dependency was added.

Install a newly built VUEO containing this shared file before testing the provider. Existing builds cannot deliver the current binary WASM bytes without loss and will report `binary bridge update required`. Plain stream-list API responses do not require binary transport.

## Evidence and limits — 22 October 2026

- Live HTTP bootstrap, player configuration and one authenticated stream API request succeeded without WebView or Turnstile. The API returned 200 with encrypted stream data; the website decoder yielded three HLS URLs.
- These were manual HTTP audits, not a successful live run of the bounded production provider. The initial development audit took 38.9 seconds across five sequential requests; no faster Android timing is claimed before device testing.
- A later independent API attempt returned 403 with `invalid api token`. The flow is not proven reliable across requests or networks. The provider requests fresh tokens and does not replay cached tokens.
- Native GET attempts to the resulting media host returned HTML 403 in development. Those attempts do not establish Android playback; returning API URLs is deliberately separated from playback verification.
- The JavaScript decoder was compared against the actual downloaded website WASM with byte-exact agreement. The module/key is not included in the patch.
- Node fixtures pass for exact movie/TV routing, identity rejection, fresh session-token requests, public decoder caching, ChaCha20 block boundaries, missing binary capability, API rejection and absence of WebView/media probes.
- Repository validation passes for 36 providers. The shared Kotlin file compiles on the JVM with its dependencies. Its actual response encoder passes byte-exact binary, default UTF-8, HEAD/media exclusion and binary-size-bound tests. A full Android APK was not built or tested here.

Manifest v1.20.77. The existing delete list includes UHDMovies, VegaMovies and VidEasy. VidLink remains deferred. Other providers and subtitle/player policies are unchanged.
