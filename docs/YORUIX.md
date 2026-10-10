# Yoruix provider imports

Source: https://github.com/yoruix/nuvio-providers (main)
Pinned commit: ed38d1aee0024f56479369c9423fefb278e0b62a

29 providers imported: eight new providers and 21 independent overlapping versions. All 74 previous providers and descriptors remain unchanged. Total: 103.
Variant numbers identify independent implementations, not upstream release freshness. Version numbering follows the next available V2, V3, V4 etc.; existing providers are not overwritten. Source code bytes and per-provider attribution are retained. See yoruix-import.json for hashes, IDs and enabled flags, and LICENSE-Yoruix-GPL-3.0.txt for the upstream license.

VidEasy V2 retains enabled=false from upstream. StreamFlix TV uses native WebSocket when available and retains its HTTP fallback when Node ws/native WebSocket is unavailable. Other runtime limits, metadata behavior and required CryptoJS/Cheerio modules follow docs/UPSTREAM.md.

Offline validation and tests do not establish live playback, site availability or exact anime mapping in the consuming app.
