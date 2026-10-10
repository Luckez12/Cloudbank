# Imported provider attribution

Source: https://github.com/D3adlyRocket/All-in-One-Nuvio
Pinned commit: 3f09a6ff4360498895e622877af7a32212f75038

62 additional providers were imported. Existing Cloudbank 4KHDHub, HDHub4u, MovieBox and KissKH remain intact; the combined manifest has 70 providers.
The source README states GPL-3.0. Its checkout contains no standalone LICENSE file. Retain upstream code comments and bundled third-party notices; see upstream-import.json for original hashes and per-provider attribution in manifest.json.
Upstream credits: Yoruix, Paregi12, Phisher98, Wooodyhood, Piratezoro9 (Kabir), KennethJYS, Real-Morpheus, Xyr0nX/Antonio, Yatin-Code, RaymondNoodles.

The upstream source bytes are preserved inside each imported file, between the source markers. A self-contained adapter handles exports, supported movie/TV input, shared TMDB details, async timeout, URL-bearing results and exact duplicate removal. Upstream settings exports remain available; their UI depends on the consuming app.

Cheerio and CryptoJS are required runtime modules for some providers. Dev dependencies let CI test real module loading; they are not injected into the app by this repository. Node-only imports are rejected; upstream optional fallbacks remain eligible. VixSrc's SOCKS proxy and Mapple's Node hash optimization are optional; Mapple retains upstream synchronous CryptoJS proof-of-work.

The 19s limit caps asynchronous waiting, not synchronous CPU work or cancellation of native requests. No live website, token, debrid service or video playback success is asserted. GramCinema and Torrentio require the upstream token/debrid settings. Settings and anime season mapping still need app verification.
