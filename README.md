# Cloudbank 1.20.50 — Remove Dahmermovies, Torrentio and CTGMovies

Overlay this ZIP at the Cloudbank repository root. Then run:

```bash
node scripts/cleanup-retired-providers.cjs
node scripts/validate.mjs
```

The manifest retires Dahmermovies, Torrentio and CTGMovies. The cleanup removes their provider files and obsolete Dahmer-only tests/cleanup script. Earlier AllWish and standalone Dahmer TV removals remain in force. DELETE_FILES.txt lists the exact deletions for ZIP patch tooling.

All other 48 provider entries and source files are unchanged, including Cinevibe. No VUEO app source or YML/workflow file is included. This does not apply the VUEO rollback; the user already performed that separately.

## Cinevibe audit — repair blocked, not claimed complete

Both a direct HTTP audit and the cloud browser failed to load https://cinevibe.asia because the upstream connection timed out. No current page scripts, player response or media source could be observed. This does not prove the website is permanently down or unavailable on the user's connection.

The existing Cloudbank provider uses fixed fingerprint/session constants, generates a time-window token with a cinevibe_2025 suffix and requests /api/stream/fetch?server=cinebox-1. The current Yoruix upstream provider was read and still contains the same domain, constants and endpoint. Its source is identical to the embedded Cloudbank upstream core after trimming whitespace. There is therefore no verified updated website flow to port from that upstream.

Cinevibe remains unchanged. The next required input is a reachable official site or its current page/player/API response, so that a provider-only repair can be based on the website's actual published behavior. No guessed domain, token algorithm or provider-specific VUEO code has been added.
