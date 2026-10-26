# HDHub4u 2.1.3

Fix WATCH captions in VUEO's read-only cheerio compatibility layer. Version 2.1.2 attempted to insert unpacked JavaScript into an empty script element using text(value); VUEO implements text() as a getter and ignores the supplied value. Node cheerio supports that setter, masking the problem in the earlier tests.

Parse subtitles directly from the already extracted/unpacked script string instead. Remove the temporary HTML document and second script walk. No new network requests. WATCH hls4/hls3/hls2 initial preference, PLAYER-2 delivery configuration, parallel collection, EN/MS filter, and server labels remain unchanged. Website runtime fallback switching is not implemented by this provider.

Validation: simple pipeline, parallel/failure isolation, delivery selection and direct packed-caption extraction tests; 25-provider validation. Device playback and scan timing remain unverified. VUEO unchanged.
