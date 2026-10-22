Cloudbank 1.20.71 — combined VidRock fast search and provider cleanup

This single ZIP replaces the separate VidRock 2.1.0 and manifest-fix ZIPs for this update. It includes providers/vidrock.js (2.1.0), manifest.json (1.20.71), DELETE_FILES.md and both VidRock regression tests. No YML or executable deletion script.

NetMirror and Peachify are removed from the manifest together. Their exact obsolete paths are in DELETE_FILES.md. In the reported repository both provider files were already deleted, so only applying this ZIP is needed. If applying over an older checkout where those files still exist, manually delete the two listed files before validation; the existing ZIP workflow does not process deletion instructions.

VidRock returns completed sources at most 1500ms after the first validated source, with a maximum of three. Slow alternatives may be omitted. Existing HLS MIME, audio, minimum 720p and first-segment checks are retained. No VUEO application change, title or device exception. The previous deterministic latency replay measured 13077ms/2 sources versus 8132ms/1 source; this is not a phone speed guarantee.

Validation: repository manifest/file inventory passes with 39 providers. Both VidRock tests previously passed; provider code and tests in this combined package are byte-identical to the tested 2.1.0 patch. Dependencies are unchanged.
