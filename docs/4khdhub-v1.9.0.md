# 4KHDHub 1.9.0 — site flow repair

Repairs the reported Vikings (TMDB 44217), Season 1 Episode 1 discovery failure.

## Changes

- Replaces the layered legacy/transfer fallback engines with one request-scoped engine. Display formatting and shared TMDB metadata remain supported.
- Uses one 18.3-second deadline and 5.5-second per-request ceiling. Pending requests are aborted when AbortController is available; runtimes without it still stop all new requests and ignore late results when the provider completes. No legacy retry starts after the extraction window.
- Parses current greenmotors public gate payloads, HubCloud continuations and gpdl redirects. The current gpdl landing page copies its `link` query parameter into the download button; the resolver follows that destination instead of treating HTML as a media response.
- Rejects HTTP-200 file-not-found pages, text/JSON error responses, dead final links, explicit wrong episode filenames and mismatched title/year candidates.
- Tries smaller releases within each quality group first, with two lazy workers. Alternative release links remain available when one host is missing. Known original language is required when the release declares its audio languages; dual/multi audio containing the original is retained.
- Probes file endpoints with HEAD; signed Workers/R2 endpoints which reject HEAD can use a two-byte Range request. Video bodies are not read by the parser. Generic HTML is never returned as a stream.
- Release resolution remains a website/file label, not a measured video resolution. HLS masters use Auto instead of inheriting a release resolution.
- Removes the old global trace wrapper, which could call itself recursively. Logs report hosts and stages without public redirect payloads or expiring media URLs.

## Verification

- `node tests/4khdhub.mjs`: exact title/year, season isolation, original audio selection, gate decoding, HubCloud/gpdl continuation, signed GET versus HEAD, missing/dead/HTML rejection, filename mismatch, master HLS, ad exclusion, abort and no late requests. Actual captured site HTML also exercises the Vikings episode parser and gpdl query-link page.
- `npm run validate`: all 52 providers load and validate.
- Live audit on 2026-10-16: the Vikings S01E01 smaller release follows greenmotors → HubCloud → gamerxyt → gpdl → public query-link landing page → Googleusercontent. The final HEAD response was HTTP 200, `video/mkv`, Content-Length 1,074,219,509 bytes. A sampled HubDrive copy returned HTTP 200 with `File not found`; that page is correctly rejected.
- This live header check proves file availability at audit time, not successful playback in VUEO. No full media download or on-device playback was performed. Other hosts and expiring links may still fail.

## Apply

Extract the patch at repository root and overwrite its files. Manifest 1.20.28 sets 4KHDHub to 1.9.0. No YAML or app files are included. Test Vikings S01E01 again and verify the provider log reports v1.9.0.
