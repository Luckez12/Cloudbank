KissKH subtitle playback transform — VUEO (60) + Cloudbank KissKH 1.4.2

INSTALL
1. VUEO/: merge these files into the VUEO-NEXT-main (60) source and build/install the updated app.
2. Cloudbank/: merge into the Cloudbank repo and refresh KissKH to 1.4.2.
Both sides are required. The old VUEO parser ignores textTransform and cannot decrypt the raw URL. No YAML or APK is included. These are patches, not full repositories.

BEHAVIOR
Provider filters English/Malay and returns original HTTP subtitle URLs with textTransform=kisskh-aes-cbc. Removes provider-side caption downloads/decryption/data-URI conversion. No subtitle file fetches during scan; video and subtitle-list API behavior otherwise unchanged.
VUEO adds a whitelisted optional subtitle metadata field. Existing shared subtitle registration propagates the marker to the session loader used on Mobile, TV and Live Sync. Only explicitly marked sidecars are decrypted; video or unmarked sources are not transformed. Preserve headers and URLs; no transformation metadata is sent as an HTTP header.
The registered subtitle cache prepares marked bytes on put, covering ReadinessProbe as well as normal Media3 loading. Cache holds plaintext for reuse by playback and dialogue sync. Evict cached entry when its transform changes. First load reads the existing full sidecar request into the existing 2 MB cache; no separate decrypt fetch is added. Uncached partial transformed requests and oversized marked sidecars fail rather than passing encrypted bytes to text parsers.
Decoder uses AES/CBC/PKCS5Padding and the two key/IV pairs in the supplied Cloudstream SubDecryptor.kt. It decrypts Base64 AES-block-sized text lines after cue timestamps, preserves timings and ordinary plaintext, and fails on suspected ciphertext that neither key can decode. Supports SRT/VTT-style cue bodies regardless of file extension. No arbitrary code, crypto configuration or external decrypt service is accepted. It does not handle every possible future format/key rotation or wrapped ciphertext layout.

VALIDATION
- Production Java decoder compiled with JDK compiler module and Android Base64 test shim: both key/IV pairs, mixed plain/encrypted cues, timing preservation, idempotent plaintext, VTT plaintext, bad key rejection, size bound PASS.
- Production SubtitleSessionCache object extracted verbatim and compiled with production SubtitleTextNormalizer plus decoder: marked preparation, plaintext cache reuse, unmarked unchanged cipher text, headers, transform-change eviction PASS.
- Cloudbank KissKH 49 regression checks and 25-provider validation PASS; no sidecar content download during discovery.
- Full Android Gradle test attempt stopped at unavailable com.android.application 9.1.1 plugin in offline dependency resolution. Full APK, device playback and actual Colony subtitle sample not verified. No claim that the two known keys decrypt every live title.

Standalone Java test (from VUEO project):
mkdir -p /tmp/kisskh-check
java -m jdk.compiler/com.sun.tools.javac.Main -d /tmp/kisskh-check shared/core/src/main/java/com/vueo/shared/core/player/KissKhSubtitleDecoder.java validation/kisskh-subtitles/stubs/android/util/Base64.java validation/kisskh-subtitles/DecoderCheck.java
java -cp /tmp/kisskh-check DecoderCheck
Test stubs belong only under validation/ and are never included in src/main.
