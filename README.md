# VidSrc HTTP-only rebuild + generic VUEO binary support

1. Copy the contents of `VUEO/` into the VUEO repository. Build and install TV/Mobile as usual. This updates ONE shared networking file; it adds a generic small-binary response option, with no provider-specific app logic or new dependencies.
2. Copy the contents of `Cloudbank/` into Cloudbank. Delete the paths in `Cloudbank/DELETE_FILES.md` if still present. Run npm run validate and refresh the repository/provider in VUEO.
3. Test VidSrc v3.0.0 and share its new log. Existing app builds may report binary bridge update required. Both parts are needed for encrypted URL lists using the current remote WASM decoder.

The provider has no WebView, title search or extra master/variant/segment/subtitle requests. It fetches fresh website-issued tokens; it never caches signed stream URLs. HLS stays unchanged and Auto.

Validation, protocol regression tests, comparison against the actual website decoder, Kotlin compilation and native binary serialization tests passed. This is not confirmed Android playback: development media-host requests returned HTML 403, and a later API audit returned invalid api token. Device speed has not been measured. A full APK was not built here.

See Cloudbank/docs/vidsrc-v3.0.0.md for evidence and limits. No YML, executable deletion script, public decoder key, session token or signed media URL is bundled. VidLink remains deferred.
