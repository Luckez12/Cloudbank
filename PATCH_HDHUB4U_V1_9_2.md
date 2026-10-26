# HDHub4u 1.9.2 — give site HLS time before download fanout

Apply at repository root; refresh and verify 1.9.2. No YAML or VUEO changes. Includes prior fixes and existing manifest baseline.

The supplied 1.9.1 log contains R2 rejections and Google nonzero Range probes answered 200 without Content-Range, leaving no eligible direct sources. A WATCH master request was still running when the provider completed. Code audit found a 1650ms HLS text ceiling and request timeouts that did not abort their underlying fetch. This is a concrete weakness, not proof of the exact remote HLS failure; do not claim the site is fixed based on synthetic tests.

Site-stream tasks now start ahead of direct-file tasks for up to 4s (or until all site tasks settle). HLS verification gets up to 4s. Identical URL/method/header text requests share an in-flight promise within one request-scoped engine. Text timeout aborts propagate to transport when AbortController is available. Failed entries can be retried. HLS failures log host/reason/elapsed without signed URLs. Collection ceiling increases from 9.5 to 11.5 seconds; the provider overall 17.5s ceiling and 3.5s post-first window remain. This prioritizes a viable stream over faster scan completion; latency and source count are not guaranteed.

R2 direct exclusion, HTML rejection and actual nonzero byte-range checks remain. Google status 200 without required range is not silently accepted. Successful HLS still requires valid playlist text, remains Auto and preserves URL/headers/audio groups. No speculative proxy/domain substitution or VUEO patch.

Tests: valid HLS arriving at 1800ms now succeeds; identical in-flight HLS uses one fetch; text-timeout aborts; download work starts after short site tasks settle. Existing alternatives, diversity, quality, R2, host-flow, fast and polish checks pass; repository validates 25 providers. Device playback and seek of the eventual WATCH HLS still require testing. If zero again, send the complete log including HLS failed timing.
