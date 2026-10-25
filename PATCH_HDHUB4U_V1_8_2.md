# HDHub4u 1.8.2 — truthful HLS quality labels

Apply at repository root and refresh provider. Includes the 1.8.0 lifecycle/host-flow fixes and user-authorized 1.8.1 R2 domain-unblock with file/seek verification. No YAML or VUEO changes. Manifest baseline contains the previous 4KHDHub 2.0.4 and authorized CineVibe/CineMode removal.

The supplied log had a valid master containing 720/480 renditions but READY q=4K. WATCH had overwritten internal quality=0 from page text, although toStream already emitted Auto for isMaster. Display formatting additionally stripped Auto. Preserve the master sentinel in extraction/expansion, use isMaster in READY logging, and explicitly retain Auto in display names. Master URL and all audio/quality groups remain unchanged. No extra HTTP requests.

Remove page-derived 1080/480/default block quality from HLS paths. Parsed variant quality uses only RESOLUTION. A standalone media playlist or variant with no resolution remains Unknown. Download-file release labels remain unchanged. The provider returns the adaptive master rather than separate rendition URLs.

Tests: hdHub quality replay with page 4K and master 720/480, master quality=0 and output/name Auto, actual variant heights and missing-resolution media playlist despite 2160 fallback. All five HDHub test scripts pass and repository validates 25 providers. No new on-device playback/seek results claimed. Test the same movie and confirm READY q=Auto and displayed Auto.
