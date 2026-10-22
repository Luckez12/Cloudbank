# VixSrc v2.0.2 — preserve the signed master in the VUEO runtime

Apply at the Cloudbank repository root, overwrite matching files and refresh the provider. No VUEO app patch is required. The existing DELETE_FILES.md remains included; VixSrc is not on that list.

## Confirmed code defect

VUEO PluginRuntime.kt implements URL.searchParams as a standalone URLSearchParams object. URL.toString() returns the originally parsed href, without incorporating later searchParams mutations. VixSrc v2.0.0/2.0.1 appended token, expires, h and lang to searchParams and then returned master.toString(). In this runtime the result was the unsigned `/playlist/{id}` URL. Native browser/Node URL automatically synchronizes these fields, so the original Node-only tests missed the defect.

The regression was reproduced using the actual URL/URLSearchParams JavaScript extracted from VUEO's PluginRuntime.kt. Before the fix the test returned an unsigned playlist path; it failed the signed-URL comparison. After the fix it passes, returning the same signed URL under both runtime implementations. Native URL parsing is simulated with Node URL; the JavaScript compatibility layer itself is unchanged from the application source.

## Change

Serialize master origin, path, searchParams.toString() and fragment explicitly. Preserve the website signature values and their proper query encoding. No app code, provider/title/device-specific app rules, additional HTTP reads, WebView, subtitle fetches or child/segment selection are added. Shared playback HTTP transport from v2.0.1 is retained.

## Evidence and validation

- A fresh website audit for the movie used in the device report received API 200, embed 200 and master 200 with an HLS body. This confirms the website master can be accessible in the audit environment; it does not prove device playback.
- The previously failing VUEO-runtime signed-master regression now passes. Existing API/episode routing, two-read budget, signed parameter/header preservation and rejection tests pass.
- Repository validation passes with 36 providers and manifest v1.20.84.
- No APK or physical Android playback test was performed. Device retest is required to establish whether this fix fully resolves the observed rejection.

Tests: `node tests/vixsrc-current.cjs` and `npm run validate`.
