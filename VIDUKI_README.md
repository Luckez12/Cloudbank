# Viduki v1.0.7

Provider-only patch: upload providers/viduki.js and manifest.json. No VUEO app changes or YML.

Video capture unchanged from v1.0.6. Subtitle index runs in parallel; choose English/Malay URLs only, maximum two per language. Return URL, normalized language, MIME from extension and headers. Do not download subtitle files or validate cue text in provider; VUEO loads/parses them. Output subtitleUrls counts URLs, not validated files. A broken upstream subtitle URL can still fail in the player.

Stop/cancel pending subtitle index at discovery completion or failure. No extra wait, polling, preparation request or language fallback. This removes up to four duplicate sidecar HTTP requests and regex false rejections; it does not promise faster website video generation. Device subtitle rendering still needs testing.
