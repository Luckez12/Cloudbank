# VidSrc.to 1.0.2 recovery

Apply at Cloudbank root; refresh repo. No app or YAML changes in this patch.

v1.0.1 changed the working outer VidSrc.to navigation to direct vsembed.ru navigation and changed its initial Referer. The user reported zero captures after 12 seconds for TMDB 1288069, where v1.0.0 had captured playable HLS. This is a playback regression correlated with the navigation change; the exact upstream reason is not established by the log.

v1.0.2 restores the original VidSrc.to WebView entry, Yumeflix Referer and 500ms completion grace. Removes HTML preflight and direct iframe unwrapping. Exact TMDB/season/episode routing, HLS validation and optional subtitle payload checks remain. Subtitle completeness is unresolved: cross-origin frame metadata may not be visible to main-document hooks. This recovery prioritizes the previously working video path. It does not claim subtitle extraction is fixed.

Checks: focused fixture tests and full Cloudbank manifest/runtime-load validation. Live recovery has not been verified on Android.
