# HDHub4u 1.8.0 — host-flow and lifecycle fix

Apply at repository root and refresh VUEO. Verify provider 1.8.0 in logs. No YAML or VUEO source changes. Manifest includes previous 4KHDHub 2.0.4 and authorized CineVibe/CineMode removal; use on the same Cloudbank-main (14) plus patches baseline.

Disable the old engine fallback which emitted getRedirectLinks encoded-payload errors on ordinary pages. The current engine has a 17.5-second budget; each invocation gets an isolated engine and closes pending fetch promises/aborts transport where supported on completion. No old engine starts after timeout and new requests are rejected after stop. Retain existing site HLS-first behavior, original-language eligibility, master Auto, direct-file/seek validation and English/Malay subtitle handling.

HubCloud candidates must be download routes on recognized file-host domains. Telegram tg/go, tutorial, ad and navigation links are not resolver tasks. gpdl/cryptonewz HTML landing pages are followed via the actual link query/downloadBtn flow, then the final file is validated. HTML is not accepted as a source. Gate data payload decoding uses Base64 decode instead of encoding already encoded data.

The R2 playback exclusion remains because earlier device evidence recorded seek/restart problems. An R2 file passing HTTP checks is not proof playback was fixed. Known R2 outputs now skip the otherwise wasted seek probe before rejection. Google/Workers alternatives still require existing HTTP and seek checks. If a title only has excluded/dead mirrors it can still yield zero sources.

Validation: tests/hdhub4u-fast.cjs, tests/hdhub4u-polish.cjs and new tests/hdhub4u-host-flow.cjs pass. New replay tests cover HubCloud -> gamerxyt -> gpdl -> query-link landing -> final Google file, Telegram/tutorial/ad exclusion and cancellation/no requests after stop. npm run validate passes for 25 providers. No live playback success is claimed for movie TMDB 969681. Test that exact movie and send the complete new provider log; success depends on current site mirrors and Android playback.
