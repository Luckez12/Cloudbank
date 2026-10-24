# StreamFlix v1.0.4

Apply ZIP contents at the Cloudbank repository root, alongside the existing manifest.json. There is no extra Cloudbank/ folder. Replace manifest.json and providers/streamflix.js; tests and this document are optional supporting files. No VUEO app change, workflow change or deletion is required. Refresh the repository/provider and confirm StreamFlix v1.0.4.

Live catalog check, 24 October 2026: data.json returned 5,359 entries (4,560 movies). Neither TMDB 1561726 nor the title Masterplan was present. This patch cannot add unavailable content.

Changes: match source TMDB ID plus media type first; fallback only to exact normalized primary/original/available alias and exact year when the source has no positive TMDB ID. Refuse ambiguous fallback and conflicting IDs. Add catalog-size and catalog-miss evidence. Deduplicate movie URLs, support absolute catalog URLs, and stop guessing 1080p/720p from bucket names. Existing TV episode resolver is unchanged and still needs separate investigation, including its WebSocket support and guessed fallback paths.

Validation: all 36 providers passed npm run validate; syntax check passed; 13 regression cases passed, including an end-to-end movie getStreams invocation using mocked HTTP with current catalog/config bytes. Live catalog lookup confirmed the Masterplan miss and the Venom: Let There Be Carnage TMDB 580489 hit. Bundled tests use a compact catalog fixture, not a live availability test. Run node tests/streamflix-matching.cjs at repository root. No actual video playback or media-host availability is confirmed.
