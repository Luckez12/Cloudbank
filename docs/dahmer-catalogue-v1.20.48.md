# Cloudbank 1.20.48 / Dahmermovies 1.2.1

## Corrected regression

Version 1.2.0's catalogue detector rejected any HTML containing `challenge-platform` or `cf-chl-`. That is too broad: Cloudflare's documented JavaScript Detections can inject challenge-platform scripts into ordinary HTML without replacing the page with a Challenge Page. A valid directory listing with that passive script was therefore rejected before extraction.

The supplied Tenzing log shows HTTP 200 followed by this detector's rejection. The exact user-client response HTML is not present, so this patch does not claim that JSD was conclusively the cause of that particular response. The faulty detection can nevertheless be reproduced with valid HTML, and has been removed.

Reference: https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/

## Current flow

- Passive JSD/script paths and Cloudflare CSS are no longer sufficient evidence of an interstitial.
- An explicit `cf-mitigated: challenge` header, a recognized challenge page title with challenge markup, or a visible security-verification heading with security evidence identifies a blocked catalogue.
- Titles and headings used for classification are extracted without script/style/comment content, so a JavaScript sample string is not treated as a visible verification prompt.
- Valid catalogue extraction proceeds to the existing published-redirect and GET media checks. No actual gate is solved or bypassed.
- Anchor extraction also excludes scripts, styles and comments, preventing example links in those blocks from becoming media candidates.
- Safe `CATALOGUE_PAGE` diagnostics record page title, character count, visible file-anchor count, presence of passive JSD and the exact gate reason. They do not expose the full HTML, cookies or signed media query strings.
- HTTP 403/404/416 and invalid media responses remain rejected. Genuine downstream p.111477.xyz access denial is not fixed by accepting passive JSD on the catalogue; it must still fail rather than create an unplayable source.

## Validation and limits

44 controlled cases pass using the actual complete provider script. They include five passive Cloudflare variants, an exact Tenzing request fixture, genuine challenge response/heading rejection, script/comment link exclusion, and a complete ordinary catalogue + JSD -> published worker redirect -> GET 403 flow. The 34 earlier media, identity, settings, quality, timing and export cases remain passing.

The full cleaned Cloudbank repository validator passes for all 51 providers. The other 50 provider entries are unchanged.

These are controlled fixture and source tests. The browser audit in the prior request remained on an actual Cloudflare verification page after one reload; the user-client HTML and real Android playback have not been verified. This patch fixes a demonstrated classification regression and retains failure rejection; it is not a claim that all website/network access issues are solved.

## Apply

Apply over 1.20.47 at the repository root. No YML or app changes. The prior All-Wish and standalone Dahmermovies-TV removals remain unchanged; if those old files still exist after applying directly to 1.20.45, use the included `node scripts/cleanup-dahmer-allwish.cjs` and commit the deletions.

Run `node tests/dahmer-get-validation.cjs` and `npm run validate`.
