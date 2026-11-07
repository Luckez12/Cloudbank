# XPass 2.0.6
Fix false rejection of VIP 1: live S02E01 master/rendition requests succeeded and the first segment GET returned HTTP 200 with 2050 aligned MPEG-TS packets, despite Content-Type text/html. Version 2.0.5 rejected this metadata.

After validating the HLS playlist, accept a successful segment status even if its Content-Type is HTML/JSON/JavaScript. Log that the type is inconclusive. HTTP errors and malformed/HTML manifest bodies remain rejected. Server race, headers, subtitles and timeouts otherwise unchanged. No VUEO or workflow changes.

This is a deliberate metadata-check relaxation. It does not inspect segment bytes in VUEO; an actual HTML error body with HTTP 200 could pass the segment availability check. The player must validate media bytes. No full device playback verified; no claim every rendition or segment works.

Passed mocked mislabeled-segment regression, 404 root/variant/segment fallback, HTML manifest rejection, HEAD405 fallback, all-unavailable case, movie/TV URL shim, AES-GCM checks and 25-provider validation.

Apply ZIP contents at repository root using existing patch workflow. Refresh XPass to 2.0.6.
