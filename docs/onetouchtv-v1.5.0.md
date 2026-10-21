# OneTouchTV v1.5.0 — Cloudbank 1.20.53

Apply after Cloudbank 1.20.52 / the KissKH v1.4.0 patch. This patch changes the
OneTouchTV provider and its manifest entry. The manifest preserves the previous
KissKH entry, all 48 active provider IDs and the prior retired-provider removals.
No VUEO app changes or YML/workflow files. KissKH playback testing is deferred
because the user reported the site down; it is not marked working.

## Problems found

- The transferred engine always sent API payloads to enc-dec.app for decryption,
  even though the actual encrypted My Demon search response could be decrypted
  successfully by the existing local AES implementation.
- It collected every search query before selecting a result, and fetched up to
  eight candidate details. A failed primary engine could start the old engine,
  repeating discovery and metadata work.
- The transferred engine did not include subtitle tracks in returned sources.
- Its decrypted/search Maps had neither a size limit nor expiry, including cached
  episode responses containing potentially expiring media links.
- The legacy fallback selected the sole episode regardless of requested number,
  or used array position if episode numbers were absent. Later-season handling
  depended on scores and could accept the wrong season. Release-year matching
  allowed a one-year mismatch, and tied candidates silently chose the first.
- Legacy subtitle substring checks could mistake French for English.

## New behavior

One resolver uses shared TMDB metadata only when its request identity matches.
Otherwise it fetches metadata once. It searches the canonical title first;
up to two additional queries are conditional on no verified match. For later TV
seasons, a season-specific query is one of those conditional fallbacks.

Plain JSON and existing envelope variants are accepted. Encrypted responses are
decrypted locally using the existing portable AES-256-CBC code, including lenient
handling of JSON control characters. Only local-decryption failure invokes the
existing external decrypt endpoint as a bounded compatibility fallback. No new
external service or authentication requirement is introduced.

Exact metadata aliases, known year conflicts, type and explicit season evidence
are checked. More than three exact candidates or unresolved duplicate title/year
matches fail closed. The API's same-title/year/type uppercase/lowercase slug
duplicates are collapsed, avoiding redundant detail requests. S2+ requires a
matching title season, detail season or explicit episode season. It never assumes
a bare unnumbered first-season entry represents a later season.

TV episodes must have the exact requested number, a matching observed season,
and both content identifier and play ID. Fractional episodes are not rounded.
No single-episode or array-index fallback. Movies require one unambiguous playable
entry. Detail IDs and title metadata are checked before fetching episode links.

Subtitle tracks from both the episode root and individual source are merged and
deduplicated. Recognized caption languages, URLs, formats and headers are
preserved; thumbnail/chapter tracks are omitted. Caption absence does not remove
video. Direct HTTP(S) media is checked against declared type or media extension;
HTML/embed URLs and invalid schemes are rejected. Source-provided playback
headers survive, while hop-specific headers are removed. Sources with different
playback headers remain distinct even if their URLs match.

## Speed and memory

The normal cold path is three provider API requests: search, detail, episode.
Local AES adds no network request. Aliases, additional exact-candidate checks and
remote decryption may add requests only when necessary. Old hosts without shared
metadata also need a TMDB request. No measured device speed claim is made.

Up to 500 compact TMDB/type/season-to-provider mappings are retained in the JS
runtime with a 30-day TTL and least recently used eviction. A cached match skips
search but refreshes detail and episode responses. Signed video URLs, subtitles,
raw search/decrypted responses and full detail lists are not retained between
calls. If the app recreates the JS context each scan, the cache does not persist;
the three-request cold path still applies. No persistent-storage or VUEO change
is part of this patch.

API timeout is four seconds, episode response five seconds, remote decryption
fallback three seconds, all within an 18.5-second provider deadline. Body reading
is included; network requests abort when AbortController is available.

## Validation

- `node tests/onetouchtv-fast.cjs`: 33 regression checks passed.
- `npm run validate`: 48 provider entries passed static validation.
- Real search response captured from api3.devcorp.me for My Demon returned
  HTTP 200 and decrypted locally into two same-title/year/type slug variants:
  `my-demon` and `MY-DEMON` (2023). The encrypted public response is included as
  a test fixture, distinct from generated mock API payloads.
- Live detail probing and the complete new provider run timed out. The complete
  run returned zero sources after search timeout. No actual media bytes, Android
  playback, seek, subtitle rendering or measured speed improvement is verified.

## Device test

Start with My Demon, TMDB 218539, S1E1. Inspect SEARCH, DECRYPT (local/fallback),
CANDIDATES, MATCH and RESULT. Test video playback, seek and available English/
other subtitles, then another episode, a later-season title and a movie. Send the
sanitized provider log for any failure. Successful discovery alone is not a
playback confirmation.

The portable AES, shared metadata/alias utilities, headers/quality helpers and
display adapter originate in the existing Cloudbank implementation. Existing
upstream attribution and license notices remain applicable; see docs/UPSTREAM.md.
