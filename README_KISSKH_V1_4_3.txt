Generic subtitle transforms — replaces previous provider-specific VUEO patch

VUEO: merge this patch into VUEO-NEXT-main (60). If the previous patch was applied, also remove the files listed in DELETE_FILES.txt. The new decoder is SubtitleCipherDecoder.java. All provider-specific names/keys/IVs are removed from the application implementation. No APK or YAML included.

Cloudbank: install the separate KissKH 1.4.3 patch. Both new sides are required. Do not use 1.4.2 with this VUEO patch (its old provider-specific string marker is deliberately not accepted).

Generic metadata contract:
textTransform = {algorithm:"aes-cbc",scope:"cue-lines",keys:[{key:"BASE64_KEY_BYTES",iv:"BASE64_IV_BYTES"}]}
Only explicit recognized configuration enables processing. Keys and IVs come entirely from the provider, never a provider-ID/domain lookup. Parser allows 1–4 key/IV pairs, AES keys of 16/24/32 bytes and IVs of 16 bytes. Invalid/unsupported declared transforms omit the subtitle rather than forwarding encrypted text. Model property is optional; unmarked sidecars are unchanged. No arbitrary plugin code or external decrypt server executes.

Existing shared playback loader/cache applies the transform while reading subtitle content on Mobile/TV/Live Sync. It preserves timestamp lines and plaintext, rejects undecodable ciphertext, caches prepared text, and invalidates cache when configuration changes. Subtitle marker never becomes an HTTP header. No scan-time sidecar fetch. Existing 2 MB file cap and partial-read protection retained. Provider handles all service-specific choices and future key updates.

Validation this revision: production Java generic decoder compiled/run with provider-supplied test keys, both fallback positions, mixed/plain text, timings, idempotency, wrong-key rejection and size cap PASS. Source inspection confirms no service identifiers or known service keys in new VUEO implementation. Provider 49 regression checks and all 25 providers validate PASS. Generic cache check source included, but Kotlin compiler was unavailable in this runtime and it was not rerun successfully. Full Android build/device playback remains unverified; previous build attempt failed resolving Android Gradle plugin 9.1.1 offline. Actual Colony sample still unverified.
