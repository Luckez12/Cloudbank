# XPass 2.0.2 — remove media probes, repair subtitle collection

Removes the 2.0.1 media availability function entirely: no HLS fetch, rendition traversal, segment Range request, DASH probe or file HEAD. The first server with supported source URLs wins as in 2.0.0. Retain request cancellation, 4s per-request timeout covering response text, server metadata, and existing exact request paths.

Subtitle list starts alongside index/loader requests. When streams exist, await the already-running subtitle request before merging and returning. There is no fixed collection grace; a slow subtitle list can extend result time until its existing 4s request timeout. An absent, empty or failed subtitle list never rejects available streams. Parse array/JSON-string/list-object/language-map subtitle shapes. Merge root, playlist-item, source track/subtitle arrays and page suburl results. Normalize known EN/MS codes and labels, reject other/unknown languages and thumbnail/sprite/chapter tracks, deduplicate URLs, preserve subtitle headers and infer VTT/SRT MIME from URL. Read label when code is und. Fetch metadata list only, not each caption file.

New SUBTITLES log reports list not-published/pending/ready/empty-or-filtered/failed, accepted list count and merged forwarded count. This diagnoses missing website metadata separately from language filtering and fetch failure.

No correction to server-side season/episode identity mapping is included yet, as requested. Removing availability probes permits inaccessible URLs to be returned again; output remains playback-unverified. Actual device subtitle availability and scan timing are unverified.

Validation: authenticated data decoder; mocked movie/TV pipeline and VUEO URL shim; delayed subtitle list completing after stream; source subtitles; EN/MS filter; empty/missing/HTTP-failed list; no CDN/segment/caption-file requests; all 25 providers validate. VUEO unchanged; no YAML.
