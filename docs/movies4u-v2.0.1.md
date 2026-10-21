# Movies4u v2.0.1 / Cloudbank v1.20.65

Overwrite manifest.json and providers/movies4u.js, then refresh the repository in VUEO. No YML or deletion scripts.

Fixes Animals (TMDB 1236045): Movies4u lists it as Animals – Netflix Original (2026), which v2.0.0 mistakenly treated as a different title. The parser now removes only explicitly delimited, recognized platform Original suffixes before exact title comparison. Title/year or IMDb checks remain enforced; Dangerous Animals and Nocturnal Animals are rejected.

The live Animals page was fetched and parsed successfully into one eligible M4uLinks route, with dual audio including English. 18 automated checks passed, including the actual Animals HTML, mismatch rejection and existing movie/TV host-chain checks. Repository validation passed with 41 providers. Device playback still needs testing.

MoviesHunt and the six providers previously removed remain absent from the manifest. If still present, delete providers/movieshunt.js manually.
