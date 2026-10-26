# XPass 2.0.4 — restore 2.0.1 with a smaller segment availability check

Restores provider and baseline tests from the delivered 2.0.1 ZIP. Removes 2.0.2 subtitle waiting/normalization/filter/merge changes and 2.0.3 identity guard. Original 2.0.1 subtitle behavior and other filters remain. Version increases to 2.0.4 so clients can update without a version downgrade.

The only availability change: after validating the HLS master/selected rendition and locating the first segment, try HEAD on that segment. HEAD response has no media body. If HEAD is rejected with 401, 403, 405 or 501, fall back to the prior bytes=0-1023 GET. Other errors including 404 reject that candidate. Reject responses declared HTML/JSON/JavaScript as before. Keep three concurrent servers, first successful result, pending-request cancellation, 4s per-request timeout and the existing overall budget. Do not download or probe all renditions/segments.

No measured speedup is claimed. HEAD may save transfer work but network round trips remain; a HEAD-blocking host incurs an extra request. HEAD success is an accessibility signal, not proof that GET playback works. As with prior validation, this does not prove episode identity or release status. An origin that returns successful placeholder metadata for HEAD may still fail later. Signed URL/session conditions may also change.

Validation: restored AES-GCM, movie/TV URL shim, subtitles as 2.0.1, root/variant/segment 404 and HTML response rejection; added HEAD405 fallback to rangedGET; 25 providers validate. Legacy identity-test command now aliases the availability suite. No live endpoint/device timing validation. VUEO unchanged. No YAML.
