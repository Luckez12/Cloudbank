# XPass 2.0.5 — reject unavailable media before selecting a server

Observed: the supplied VUEO log selected VRK 1 and playback failed with IO_BAD_HTTP_STATUS. A live request on 7 November 2026 to the VRK 1 media URL returned for TMDB 126437 S02E06 received HTTP 404. This does not establish availability on every other server or the cause of the missing episode.

The provider now races servers through an availability check instead of selecting the first syntactically valid URL. HLS checks the master, first declared rendition (up to three playlist levels), and first media segment using HEAD. If HEAD receives 401/403/405/501, it requests bytes 0–1023 via GET. It rejects unsuccessful status codes, empty/malformed manifests, and segment responses declared HTML/JSON/JavaScript. DASH checks MPD structure; direct files require a successful media-type HEAD.

Requests and body reads are limited to four seconds each within the existing 17.5 second budget. Pending fetches are aborted on completion where AbortController is supported. No VUEO edits or workflow changes. Subtitle selection and timing remain unchanged.

Limits: successful HEAD is not proof that GET playback works. This does not verify every rendition, segment, encryption key, episode identity or future signed URL validity. If a server ignores Range and AbortController is unavailable, transfer size cannot be enforced by the provider. Device playback has not been tested; the live endpoint test used the original resolver with a longer diagnostic timeout because network requests here were slow. Production timeout remains unchanged.

Validation passed: AES-GCM authentication, movie/TV pipeline including VUEO URL shim, unavailable root/rendition/segment fallback, HTML rejection, HEAD405 ranged-GET fallback, all servers unavailable, and repository validation for 25 providers.

Install: apply the ZIP contents at the Cloudbank repository root using the existing patch workflow, then refresh XPass in VUEO. Expected XPass version: 2.0.5.
