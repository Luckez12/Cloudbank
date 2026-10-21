# MovieBox v3.0.0 — Cloudbank 1.20.54

Apply after the OneTouchTV v1.5.0 patch (Cloudbank 1.20.53). Changes only MovieBox
and its manifest entry, plus tests and review notes. All 48 provider IDs and
previous provider versions/removals are preserved. No app or YML changes.

## Findings

The previous provider combined a mobile transferred engine, an H5/website engine
and two more mobile engines. A delayed primary could start alternate engines in
parallel, and the first wrapper could start H5 again after an 11-second attempt.
Timed-out promises did not themselves prevent further requests.

The mobile resource flow fetched every page (up to 20 pages per quality) before
filtering the requested episode. Its successful direct-resource path omitted
subtitles. The verification cache used resolution/size/duration/host instead of
the actual file URL, allowing different resources with the same metadata to share
a result. CDN HTML responses were not explicitly rejected if status/size looked
plausible. Search could accept a one-year mismatch and silently choose an exact
title/year tie. Title normalization erased arbitrary parenthesized text, including
potential dub labels, and removed non-Latin titles.

## Changes

- One isolated mobile engine runs first. The existing H5/website engine runs only
  after primary failure, within the same 18.5-second deadline. Two redundant mobile
  alternate engines are removed. Existing request signing, session bootstrap,
  resource routes and website bridge integration are retained.
- TMDB metadata is shared once after ID/type verification. Each engine receives
  the same validated metadata and its own session/cache state, preventing
  concurrent episodes from overwriting each other's state. Original-language
  metadata is carried through when supplied.
- Mobile host attempts are limited to three known existing API hosts per call;
  total native fetch calls are capped at 16 for mobile and 12 for the H5 fallback.
  Per-request header/body operations have bounded timeouts; network cancellation
  is used where supported. Later requests reject after engine completion/deadline.
  WebView timeout is clipped to remaining time. Browser-internal HTTP requests
  are managed by the existing bridge, not included in those fetch counters.
- The reliable existing resource-pack request (`se=0&ep=0`) is retained. Each
  page is filtered to the exact TV season/episode immediately. Pagination stops
  when a suitable matching direct resource exists; otherwise it can continue up
  to the existing page limit while request/time budget remains. Unrequested
  episodes are not accumulated or probed. 720p fallback is conditional on the
  1080p resource path failing. Quality labels use actual API metadata.
- Exact aliases/type, known release year and ambiguity are checked. Later TV
  seasons may carry later release dates. Non-Latin titles are preserved, and only
  trailing year parentheses are removed; arbitrary dubbing labels are retained.
  H5 fallback cannot bypass the exact title/year/type checks.
- Known foreign audio languages are rejected against TMDB original language;
  explicit dub flags without a language are rejected. Country and caption
  language do not prove audio language. Unknown audio remains unverified and is
  never labeled Original. This is not a full media-track audio inspection.
- CDN verification uses the actual URL/resource identity, not same-size/duration
  fingerprints. Known notice resources, HTML/JSON/image responses and tiny-file
  mismatches are rejected. Resource playback headers are retained. Range probes
  inspect status, MIME and total-size headers; they do not decode or prove the
  video's content. No claim of complete playback validation is made.
- Mobile captions are requested using the selected subject/resource ID and the
  requested TV episode. A stream-caption fallback is used only if a real stream
  ID is provided by the resource; a resource ID is not guessed to be a stream ID.
  Caption work is bounded to 1.8 seconds and failure does not discard video.
  Unknown caption language is not defaulted to English. Existing H5 captions are
  retained with one selected stream seed on its selected host, rather than all
  stream seeds on all mirrors.

There is no persistent signed-media cache. Mobile authentication and verification
state are isolated per discovery invocation. Cold/warm device speed has not been
measured. The patch prioritizes avoiding redundant requests and incorrect matches,
not a promised response time or total coverage of every title/server.

## Validation

- `node tests/moviebox-fast.cjs`: 35 regression checks passed, using controlled
  API/CDN responses. The fast mobile fixture needs five requests: authentication,
  title search, resource pack, range probe and resource captions.
- `npm run validate`: static validation passed for 48 providers.
- Live signed bootstrap probes before the rewrite returned HTTP 200 / JSON code 0
  from api.inmoviebox.com and api3.aoneroom.com. Those probes did not establish a
  usable authentication token, resource or playable media.
- A full live run of the new provider for My Demon S1E1 returned zero sources:
  mobile bootstrap hosts timed out, then H5 failed to obtain a matching title.
  It completed in approximately 16 seconds on this test network. Android playback,
  seek, subtitles, actual audio tracks and device speed remain unverified.

## Device test

Try My Demon (TMDB 218539) S1E3, matching the episode used for the successful
OneTouchTV device test. Check the mobile auth/search/resource/CDN/caption stages
and final source count, then test playback, seek and subtitles. Also test a movie
and another TV episode. Share the sanitized MovieBox log if it fails; successful
discovery alone does not establish playable or original-audio media.

Signing and resolver implementations are adapted from the already-bundled
Cloudbank/upstream engines. Existing license/provenance notices continue to
apply; see docs/UPSTREAM.md and the repository's upstream license files.
