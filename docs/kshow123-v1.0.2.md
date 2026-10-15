# KShow123 1.0.2 — local AES and extraction diagnostics

The Android export captured successful HTTP 200 API responses (135 and 841 characters) but no sources. It did not include response bodies, so it could not establish whether parsing or decryption failed.

This patch embeds an isolated CryptoJS 4.2.0 AES/OpenSSL decoder inside providers/kshow123.js. It does not call the app's crypto-js module, JNI crypto or remote scripts. MIT license is included. Existing metadata, title/season/episode matching and runtime limits remain in place.

The response parser accepts quoted keys and changed file/type/track property order. Diagnostic stages distinguish DECRYPT_OK, DECRYPT_ERROR, PARSE_UNSUPPORTED, API_RESPONSE, and excluded subtitle placeholders. API_RESPONSE reports character count, matched file count, decryption failures and iframe presence. Logs contain no signed media URL or ciphertext. Per-server source counts are now independent.

An iframe-only server is reported explicitly and is not falsely claimed as extracted. The observed V.I.P 2 player response uses encrypted HLS. intro.vtt remains excluded because it is a placeholder, not an episode subtitle.

Validation passed:
- All 51 provider entries load and validate.
- Regression tests against saved real E821 HTML/API responses, including unavailable episode metadata and mismatched title/date cases.
- Independent Node crypto MD5/OpenSSL AES-256-CBC test vector.
- Tests with the host crypto-js module forbidden, quoted/reordered fields, subtitle separation, invalid ciphertext and iframe diagnostics.
- Actual QuickJS engine: local AES decodes the independent test vector and the saved real 841-character V.I.P 2 API response into an HLS URL; intro.vtt is excluded.

This verifies extraction in a standalone QuickJS engine. Android VUEO playback, CDN access and subtitle rendering are still unverified. The exact cause in the earlier Android run is not proven without its response body; the new logs will distinguish the remaining cases.

Apply ZIP at repository root. Provider version 1.0.2; repo version 1.20.22. No YAML/workflow modifications.
