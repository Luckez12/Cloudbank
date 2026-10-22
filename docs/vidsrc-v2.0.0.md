# VidSrc v2.0.0 — website bootstrap rebuild

The previous parser expected `class="server" data-hash="…"` on the embed page. Live checks on 22 October 2026 found that `vidsrc.me` redirects to `vidsrc.sh`, whose embed HTML has no server hashes. It loads `/vs_src.php` at runtime to obtain a short-lived nested player URL. The nested player then loads a player configuration, a one-use API token, a WASM stream decoder and a Turnstile gate.

The provider now opens the current exact movie or episode embed route in one existing VUEO WebView session. The website runs its own bootstrap and verification. The provider returns only HTTP media URLs observed as network requests or responses within that session; HTML player URLs, blobs and unobserved candidates are rejected. There is no direct API replay, stored session token, external decryptor or provider-specific VUEO change.

Observed master HLS is kept intact with adaptive MIME and Auto quality. There are no extra native HTTP checks, child playlist reads, quality filters, segment probes or subtitle fetches. Session-observed request headers are preserved. Explicit dub-only metadata is rejected; unknown audio remains accepted. Audio tracks are not independently verified.

The browser can return once it observes media without waiting for browser playback readiness. Its maximum wait is 17 seconds; no speed or playback guarantee is claimed. The initial media manifest/file and native playback have not been tested on Android for this rebuild. Turnstile may prevent discovery in an embedded WebView. An empty timeout remains an empty result, never a fabricated playable source.

Validation: `npm run validate` passes for 36 providers. `node tests/vidsrc-browser.cjs` checks exact movie/episode routing, missing episode rejection, original master URL/MIME/headers, duplicate and unobserved candidate rejection, audio metadata handling and empty sessions. These are runtime-contract fixtures, not live playback tests.

This patch removes UHDMovies, VegaMovies and VidEasy from the manifest and lists their JavaScript files in `DELETE_FILES.md`. VidLink stays installed and is deferred for the last review. VidRock and the existing application/player are unchanged.
