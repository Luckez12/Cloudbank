# Cloudbank 1.20.47 / Dahmermovies 1.2.0

## Verified defect and website audit limitation

The supplied Android logs show final playback HTTP 403 at p.111477.xyz while discovery reported successful links from a.111477.xyz. The previous TV resolver returned response.url without checking the HTTP status, and returned the original URL after a request exception. Its fallback engines could also publish unchecked URLs. The previous merge retained those behaviours; it did not establish that the links were playable.

Live HTTP checks of the root, catalogue and supplied Masterplan directory returned Cloudflare security-verification responses. A normal browser visit to the exact supplied catalogue followed by one reload remained on the verification page. No catalogue content or fresh media redirect could be inspected through this session. Therefore it is not established that the website changed its page structure, domains or endpoints. No new site route, proxy, worker or security workaround has been invented. The existing directory routes are retained from the supplied implementation and user logs.

## Rebuild

The obfuscated primary/TV/alternate stack is replaced with one readable engine. It retains exact movie title/year directory construction, English/original metadata title alternatives, padded/unpadded TV season directories, exact season/episode boundaries, specials, quality controls, actual known resolution labels, Unknown, and 4K priority. HTML links may include nested elements and escaped attribute entities. Query strings on published links and redirects are preserved.

Media discovery uses GET, with a two-byte Range on file candidates, following only published HTTPS Location headers. It checks the final success status, content type and partial response range/length. HTTP 403/404/416 and other failures, HTML/JSON/text errors, missing/unverified MIME, invalid redirects, loops and inconsistent ranges are rejected. A failing candidate unlocks the next published candidate. There is no legacy fallback which can restore a rejected URL.

HLS candidates retain playlist validation and Auto quality. Movie/TV file candidates retain their known quality and MIME. Playback uses the same User-Agent/Referer as validation, without an overriding fixed Range header, so the player can request the appropriate byte range for seeking. This does not add cookies, browser challenges, alternate network paths or app changes.

The engine has one 18.3-second extraction deadline and an 18.5-second public bound. HTTP and response reads are bounded. Expired request scopes cannot start more HTTP. A request already in flight may outlive its local timeout if the host cannot cancel it; its result is ignored.

Catalogue HTTP 403/429 or a security-verification page stops discovery rather than repeatedly probing alternative catalogue routes. Failed sources return no results, rather than a false successful source. A GET header/playlist check is availability evidence at discovery time; it does not guarantee Android playback, identical client session behaviour or future link validity. No full media file was downloaded or decoded in testing.

## Apply

Apply this ZIP at the Cloudbank repository root over 1.20.46. It preserves the earlier All-Wish and standalone Dahmermovies-TV removal; CloudAnime remains unchanged. There are 51 provider entries.

If applying directly over Cloudbank-main (8).zip / 1.20.45, run `node scripts/cleanup-dahmer-allwish.cjs` after extraction and commit its two file deletions. The existing ZIP workflow does not delete files automatically. Existing cleanup remains safe to rerun.

The old `tests/dahmer-consolidated.cjs` command now forwards to the new suite, replacing outdated HEAD/fallback assumptions.

## Validation

- `node tests/dahmer-get-validation.cjs`: 34 controlled cases passed, including the reported catalogue-to-worker GET 403, successful GET media headers, signed redirects, failed statuses, MIME errors, invalid ranges, dead-candidate fallback, redirect cycles, catalogue challenge handling, exact TV mapping, quality settings, special seasons, shared metadata identity, HLS, deadlines, settings and invalid input.
- `node scripts/validate.mjs`: the full cleaned repository validates all 51 providers with this patch.
- These are fixture/source checks, not a verified current website extraction or on-device playback result. Live catalogue structural comparison and playback remain blocked/unverified.

No YML or VUEO app files are included.
