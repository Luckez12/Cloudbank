# XPass 2.0.1 — media availability

2.0.0 accepted the first syntactically valid source URL from a playlist API, without checking the referenced media. The supplied VUEO log shows later ERROR_CODE_IO_BAD_HTTP_STATUS; it does not reveal the exact HTTP status or establish release dates.

2.0.1 waits for media availability before selecting the winning server. HLS: fetch the manifest, follow the first declared rendition (up to three playlist levels), require a nonempty EXTINF media playlist, then request bytes 0–1023 of its first media segment. Reject unsuccessful HTTP responses, malformed/empty playlists and segment responses declared HTML/JSON/JavaScript. DASH: verify reachable MPD structure. Direct files: HEAD with media content type. Failure leaves other server tasks eligible. Only one successful candidate is returned as before.

This is an access check, not proof of episode identity, full playback, all segments, encryption keys, rendition health, seek support, or release schedule. Servers that ignore Range may send more data; AbortController is used to cancel after the binary response becomes available when supported. No full-file download is intentionally requested.

Request timeouts now cover text body reads, capped at 4s per request within the existing 17.5s overall budget. Cancel pending requests when the provider finishes. Add the `server` metadata field recognized by VUEO. Subtitle behavior otherwise unchanged; this patch does not fix the separate subtitle timing/language-filter review findings.

Validation: AES-GCM tests, mocked full pipeline and URL shim; unavailable first server fallback; all servers root 404, variant 404, first-segment 404 and HTML-with-200 return zero sources; 25-provider validation. No live device retest of TMDB 126437 S02E05. Availability checks add scan requests/time.

VUEO unchanged. No YAML.
