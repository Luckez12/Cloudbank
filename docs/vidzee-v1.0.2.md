# VidZee 1.0.2 — remove segment probing

User reported playback worked with 1.0.0 but stopped after 1.0.1. Their latest log still returns English and IPcloud URLs; it shows the new English 0.jpg segment-header request, but includes no player error. The exact playback failure cause is therefore not established.

This patch removes every binary codec parser, segment/init request, Range header and arrayBuffer probe introduced in 1.0.1. Source discovery again follows the original 1.0.0 API -> HLS playlist -> returned-source flow. Returned source URLs, types and request-header handling are preserved. No media segment is fetched by provider discovery. Sources with media-only playlists display Auto, as before; the confirmed 720p sample is not hard-coded into later requests.

Original-language filtering remains: Vikings requests English rather than Hindi forced-language sources; explicit non-original payloads are removed. Default Auto language sources remain unverified. Subtitle handling is unchanged.

Validation: all 52 providers pass repo validation. Tests cover source URL/type/headers, no Range/binary/segment requests even when playlist segments use .jpg names, media-only Auto quality, master resolution, server isolation, source order, movie/episode routing and original-language filtering.

Playback must be retested in VUEO; this patch does not claim the regression is proven fixed before that test. If it persists, the next evidence needed is the player error for the selected English source rather than another source-discovery-only log.

Repo 1.20.25; provider 1.0.2. Apply ZIP at repository root. No YAML/workflow changes.
