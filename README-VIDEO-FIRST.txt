Cloudbank VidLove v2.5.0 — Video First / Deferred Subtitles
Repository version: 1.20.94

INSTALL
First apply the accompanying VUEO app patch and build/install the APK. Upload manifest.json, providers/ and tests/ from this ZIP into the Cloudbank repository root. Refresh Cloudbank in VUEO.
Older APKs may ignore subtitleRequests: video can still play, but late subtitles require the new app patch. No workflow/YML is included.

CHANGE
No subtitle HTTP during provider scan. The existing video engine race and website fallback remain. The first eligible video is returned immediately. Payload subtitles are retained; when missing, one exact movie/episode subtitleRequests descriptor is returned for the selected player to resolve. No title-specific rules or hardcoded media links.
Media URL, headers, known-quality >=720p/unknown policy and original-audio selection are retained. Actual scan time still depends on the video server; removing the subtitle wait does not guarantee a fixed latency.

VALIDATION
node tests/vidlove-current.cjs
node tests/vidlove-browser-fallback.cjs       (18 checks)
node tests/vidlove-website.cjs                (12 checks)
node tests/vidlove-parallel-subtitles.cjs     (6 video-first regression checks; existing filename retained)
npm run validate                            (36 providers)
All passed with mocked responses. Physical-device playback requires testing with the new APK.
