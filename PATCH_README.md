Cloudbank only. Apply at the Cloudbank repository root and follow DELETE_FILES.md for remaining listed files. Requires the SEPARATE VUEO Player-Stage Diagnostics v2 patch and rebuilt app. Refresh provider to VidSrc v3.2.1.

Adds FRAME_PLAYER and PLAYER_STAGES observations after Play: player created/DOM-ready, scripts/errors, verification event, stream API distinguished from metadata, verification/WASM requests/errors and client-restriction warning count. Native HTTP/media probing, website flow, Play behavior and timeout are unchanged. No binary update or dependency change is needed.

This is a targeted diagnostic revision, not a verified playback repair. Full device behavior remains unverified. Validation and regression fixtures pass. No YML or deletion script.
