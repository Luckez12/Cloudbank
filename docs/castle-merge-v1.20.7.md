# Castle consolidation — Cloudbank 1.20.7

Castle provider version: 2.1.0.

## Audit

The original decoded Castle implementation and readable Castle V2 use the same api.hlowb.com backend, security-key route, AES-CBC key suffix, search/detail flow and getVideo2 endpoint. Their language-specific and shared requests differ by the languageId body field; these are request modes, not separate provider backends. Both preserve playback headers and subtitle metadata. User reports both providers played before this change.

## Changes

The readable V2 core now runs inside the original Castle metadata/input/display wrapper. Castle V2 is removed from the manifest. No unique server pool was discarded.

Metadata and security-key discovery run concurrently. Individual audio requests run with at most three workers and bounded waits inside a 17.5-second extraction budget; completed tracks survive failed or timed-out tracks. Shared mode remains the fallback when no individual stream succeeds. Very slow or numerous tracks can be omitted by the runtime budget.

The response parser accepts videos without top-level videoUrl, handles numeric quality and empty video arrays, and preserves subtitles and playback headers. Season/episode comparisons accept numeric strings and season zero. If an explicit season list excludes the requested season, extraction returns no streams rather than selecting another season.

The native AES signed-byte adapter remains, but is local to Castle instead of repeatedly monkey-patching the shared crypto module. Short keys now receive byte-counted padding. Search matching and first-result fallback remain upstream behavior; ambiguous titles still need live testing.

## Apply

Extract the ZIP into the Cloudbank repo root. Manually delete providers/castle-v2.js. ZIP extraction cannot delete an existing file. The manifest includes previous 1.20.6 changes, so apply to that baseline. No YML or automatic deletion workflow is included.

## Validation

Validator: 98 providers. Full suite: 236 JavaScript tests and 7 Python tests passed. Castle-specific tests cover the encrypted movie API flow, three-worker concurrency, all audio tracks, video-array-only responses, subtitles/headers, season-zero string routing, missing season rejection, individual failure/shared fallback, native AES and CryptoJS fallback without global mutation, timeout rejection and 4K sorting. These are offline/mock tests, not live Android or external-player playback verification.
