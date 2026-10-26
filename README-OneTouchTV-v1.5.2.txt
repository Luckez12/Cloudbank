Extract over Cloudbank root. Provider patch only; no VUEO changes.

Optimized existing local AES-CBC decoder: inverse multiplication lookup tables,
local table references, direct row permutations, cached expanded static key.
Protocol, key/IV, payload semantics and stream URLs/headers unchanged. No extra
HTTP requests, media probes, or new decoder services. Existing remote decoder
fallback remains failure-only. Decrypt log now includes bytes (encoded string
length), decodeMs (decrypt plus envelope handling), parseMs (final parse/unwrap).

Only identified English/Malay external subtitles forwarded at root and source
levels. Other languages, unknown labels, mixed ms-ind and Indonesian rejected.
Canonical language fields en/ms; human-readable labels retained. Filtering does
not fetch subtitle files. Unique-title/year-season policy from v1.5.1 retained.

Validation: 45 provider regression checks, 6 AES equivalence checks against
CryptoJS-generated ciphertext including Unicode and synthetic 825-episode
payload. Final decoder ~390ms versus ~4038ms baseline in one Node VM comparison
for 303666 encoded characters. This is not an Android timing guarantee. Earlier
lookup implementation was slower and was further optimized before delivery.
Manifest validates 25 providers. Reported 4.23s episode API latency is outside
local decoder work. Actual device scan/playback requires testing. No YAML files.
