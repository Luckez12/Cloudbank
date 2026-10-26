# HDHub4u 2.1.0

Search → one detail page → WATCH and PLAYER-2 concurrently → return both successful results with distinct serverName labels.

One link per player is selected on the matched detail page. Each player request has a 4-second limit; the existing 12-second total deadline remains. Both tasks settle before results return, so the slower player can extend scan time. A failed or missing player does not discard the other. No quality collection grace, download chain, WebView or media/seek probes.

PLAYER-2: Hubstream /api/v1/video with player dimensions and empty external-referrer parameter, matching standalone player navigation. Decode API AES-CBC response locally. Return its source HLS and English/Malay subtitle metadata without extra subtitle requests. WATCH behavior remains unchanged. Quality remains Auto; no invented rendition labels.

Live check: Moana detail page exposed WATCH and hubstream.art/#rvcces. The PLAYER-2 API returned an encrypted response containing source HLS and an English subtitle. Stream playback itself has not been tested here. Requests using the detail-site hostname as the API r parameter were rejected, while standalone r= succeeded.

Validation: simple regression suite, concurrency/failure-isolation/encrypted API suite, provider validation (25). VUEO is unchanged. No YAML files included.
