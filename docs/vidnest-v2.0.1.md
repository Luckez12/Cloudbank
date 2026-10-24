# Vidnest 2.0.1 — VUEO crypto compatibility repair

Apply ZIP contents directly at the Cloudbank repo root alongside manifest.json. Replace providers/vidnest.js and manifest.json; supporting tests/docs are included. No extra Cloudbank directory, app patch, dependency install for VUEO, workflow or provider deletion. Refresh and confirm Vidnest v2.0.1.

User log for movie TMDB 1148365: all three new.vidnest.fun APIs return HTTP 200, then fail with cannot read property AES of undefined. This is a provider/runtime compatibility failure: the native crypto-js facade does not expose algo.AES. Node npm CryptoJS tests did not reproduce that restricted facade in v2.0.0.

v2.0.1 embeds isolated MIT CryptoJS 4.2.0 core/base64/SHA-256/AES/ECB/no-padding and their transitive modules inside the downloaded provider. Public client constant, GHASH authentication, v2 envelopes, nonce, API routes, deadlines, media checks and output selection remain as in v2.0.0. Runtime require(crypto-js), Node crypto, process.env and remote decrypt services are not used. Only provider-owned modules are resolved. The embedded core optional crypto lookup is locally rejected/caught; the protocol code uses its existing request-nonce generation and never uses library random for key or IV generation.

Validation: syntax and npm run validate pass for 36 providers. Regression harness now blocks ALL external runtime module access and validates the full standalone provider wrapper. 23 protocol/workflow assertions pass plus 3 comparisons against previously captured actual v2 API responses (26 total), independently verified against Node AES-GCM. Tests generate their own cipher vectors; no actual signed media URLs or account data are bundled. Run node tests/vidnest-v2.cjs at repo root with Node 20+. Test harness uses Node crypto only as an independent oracle, outside provider sandbox.

The fixed failure is demonstrated by a successful authenticated decrypt with no host crypto module. Successful Android playback, media availability for TMDB 1148365 and TV stability remain unverified. Retest the same title and share provider/player log. StreamFlix remains planned for deletion only.
