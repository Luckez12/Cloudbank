# UHDMovies 1.3.0 — current-site parser and resolver repair

## What changed

Replaces the two merged legacy engines with one provider under the same uhdmovies ID. The old fallback could repeat the same incorrect title/season behavior and return an HTML gate as a source.

Search now requires an exact normalized title/alias plus matching year when both are available. The live Vikings search lists Vikings: Valhalla first; the new matcher rejects it and selects Vikings (2013). Detail-page title/year is checked again.

The episode parser reads h2–h5 season headings, carries release metadata in document order, accepts exact Episode N or SxxExx labels, skips packs, and refuses links without unambiguous season evidence. On the captured current Vikings HTML, S1E1, S2E1 and S6E1 each select two release links from the requested season instead of mixing every Episode 1. Movie parsing preserves the individual release quality; the current Joker page yields two advertised 2160p and three 1080p entries.

The resolver follows current lp-land and lp-s1-form POST navigation, literal script cookies, lp_go, meta/JS redirects, Driveseed r/file/zfile pages, multipart cloud-link generation, and the legacy VideoSeed API contract. It parses known navigation data without executing downloaded JavaScript. Cookies stay with the matching host. Unresolved HTML is never returned as a playable source. File-host episode identifiers are checked when supplied.

Discovery has an 18.3-second total budget, per-request limits, two release workers and up to two file-host actions per page. No duplicate legacy engine starts. Logs show matching, short-link stages and host failures without exposing signed URLs or cookies.

## Validation and limits

The UHDMovies regression suite and 52-provider repository validation pass. Tests cover Valhalla/year rejection, numeric movie title 1917, season isolation, ambiguous-season rejection, individual movie quality labels, current navigation forms/cookies, Driveseed redirects, multipart cloud generation, VideoSeed API, wrong host episode, host errors, ad-link exclusion and sanitized logs.

Live navigation reached the Driveseed page for Vikings S1E1. The sampled Instant Download redirected to video-seed.dev, whose page returned Site Unavailable and whose API returned HTTP 405. The sampled Resume Cloud generation returned error=true / Unknown error, including when session cookies were retained. Final media extraction from this sample and playback in VUEO are NOT verified. Synthetic success-path tests verify the supported contracts, not upstream availability. Other releases/hosts may behave differently.

Quality comes from release/file-host labels, not codec measurement. Multi-audio files can contain both original and dubbed tracks; known releases lacking the TMDB original language are excluded when that language is available. An unavailable language is not guessed. Embedded MKV subtitles are not advertised as external subtitle URLs.

## Apply

Cloudbank repo 1.20.27; UHDMovies provider 1.3.0. Apply the ZIP at the repository root and refresh the repo in VUEO. It contains manifest.json, providers/uhdmovies.js, tests/uhdmovies.mjs and this note. No YAML changes. VidZee remains 1.0.3.
