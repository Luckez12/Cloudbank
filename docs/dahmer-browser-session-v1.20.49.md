# Cloudbank 1.20.49 / Dahmermovies 1.3.0

Requires the VUEO Phase 19 app source patch. Older apps report APP_UPDATE_REQUIRED; the provider does not return the failing broker URL as a source.

## Verified website behavior

The live catalogue has ordinary file anchors. Its current downloadViaProxy JavaScript opens `https://p.111477.xyz/bulk?u=` plus the public file URL. This route is current. Native requests returned 403 with cf-mitigated: challenge. After the user completed browser verification, a generated workers.dev `/d/<token>/<filename>` redirect was observed. One bounded ranged request returned 206; later small range checks returned 429. Full playback, media signature and seeking were not verified. A single-use-link rule was not established.

## Changes

The catalogue engine retains exact movie year, TV season/episode boundaries, padded/unpadded TV folders, quality switches and quality ordering. The first available candidate goes through the app's provider-specific browser session, following the published broker route. Verification is completed by the user in a visible screen. Cookies stay in Android's browser profile and are not exported to provider JavaScript or the native media client.

A fresh observed redirect matching the public filename is handed to playback with the browser User-Agent, Referer and initial Range header. Neither provider nor browser manager caches generated URLs. Normal discovery caching is bypassed when Dahmermovies participates. There is no native broker fallback or provider CDN preflight. Actual interception behavior depends on WebView and still needs a device test.

HTTP 429 stops provider candidate iteration. The companion app stops Media3 retries and automatic source recovery on 429 on both Mobile and TV. Other errors retain normal recovery. Manual retry remains available after waiting.

## Install and test

1. Merge/build/install the companion app patch first, preserving Phase 18.
2. Apply this ZIP at the Cloudbank repository root. Run `node scripts/cleanup-dahmer-allwish.cjs` to retain the earlier AllWish and standalone Dahmer TV removals. The cleanup also removes the two superseded native-media test files listed in DELETE_FILES.txt.
3. Refresh Cloudbank and run Dahmermovies once for a title present in the catalogue.
4. Open Dahmermovies diagnostics and press **Verify website access**. Complete any site verification. Once access is verified, return to VUEO and run discovery again.
5. Confirm MEDIA_HANDOFF, then test first frame and forward/backward seeks. Stop and wait if 429 appears. A returned source alone does not establish playback success.

A catalogue challenge at a.111477.xyz still stops discovery; this patch handles the demonstrated broker-stage failure and does not add authenticated catalogue transport. Android System WebView must be available and accepted by the site. Full Gradle app build and real Android playback remain pending.

39 provider fixture checks passed. The other 50 Cloudbank providers remain unchanged. No YML/workflow file is included.
