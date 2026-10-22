Cloudbank-only patch. Extract at the Cloudbank repository root. Follow DELETE_FILES.md if its three provider files remain present. Refresh the repository/provider in VUEO.

VidSrc v3.0.1 corrects website request Origin, Referer, cache headers and the exact API query. No new VUEO patch. The earlier generic binary transport app update remains required for remote WASM responses.

Validation and regression checks passed. A manual API audit succeeded with website-style headers, but device playback and speed are unverified; earlier API/media requests returned 403. No WebView, additional media probes, YML or deletion script.
