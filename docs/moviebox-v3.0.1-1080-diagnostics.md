# MovieBox v3.0.1 — 1080p resource diagnostics

Cloudbank 1.20.55, based on 1.20.54 / MovieBox 3.0.0.

The device log for My Demon (TMDB 218539), S1E3 shows two matching resources in
the 1080p request, zero eligible candidates, then a successful 720p fallback.
The 720p file's API and CDN sizes agree at approximately 238 MB. Twelve subtitle
tracks reached the player, English was selected, and VIDEO_FIRST_FRAME appeared.
That log does not explain why both 1080p-request resources were excluded and
does not prove 1080p is absent from the upstream catalog.

This patch adds bounded diagnostics. It does not add requests, force a 1080p
label, relax source checks, or change candidate ranking/pagination policy.

- RESOURCE_PAGE: requested resolution, page, row count, exact episode count,
  audio exclusions, retained rows, hasMore and the existing pagination decision.
- RESOURCE_ITEM: up to eight matching resource summaries per requested quality,
  before URL/resource-ID deduplication. Includes requested vs numeric actual
  resolution (0 means unknown), resolution field shape, link presence, size,
  duration, explicit membership/link type if available, and bounded field names.
  Rejection reasons: missing_resource_link, non_http_resource_link,
  below_min_resolution or notice_resource. Eligible rows are identified as
  eligible_before_dedupe, not as verified video.
- RESOURCE_SELECTION: counts before/after the existing URL/ID deduplication,
  eligible count and number selected for the range probe.
- MEDIA_CHECK: actual HTTP status, MIME category, API/observed total size and
  acceptance/rejection reason. An HTML response retains its real HTTP status in
  diagnostics even though it is internally rejected as non-media.

No signed URLs, query parameters, cookies, token values, resource IDs, raw API
payloads, or caption text are added to these diagnostics. Logs are capped at
eight resource summaries per quality; extra rows produce one truncation summary.

Validation: 45 controlled regression checks passed, including the previous 35
behavior checks, requested/actual quality diagnostics, missing-link and low-
resolution reasons, MIME/size failures, privacy, and bounded log volume. Provider
syntax/module loading and manifest scope were checked. The full repository's
48-provider validation was not rerun from this provider-only patch snapshot.
No new live 1080p availability or playback result is claimed.

Test My Demon S1E3 again and send the sanitized log, especially RESOURCE_PAGE,
RESOURCE_ITEM, RESOURCE_SELECTION and MEDIA_CHECK. The next change should follow
the actual rejection reason rather than assume that requesting 1080 guarantees
an available 1080p stream.
