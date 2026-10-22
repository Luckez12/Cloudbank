# VixSrc v2.0.1 — shared playback HTTP transport

Apply at the Cloudbank repository root and refresh the provider. No app source files or workflows are included. Follow DELETE_FILES.md for the existing deletion list.

The only playback change from v2.0.0 is the existing generic VUEO instruction `X-VUEO-HTTP-Transport: shared`. VUEO's PlaybackHttpTraceDataSource consumes and removes this instruction, then uses OkHttpDataSource with PluginHttp.client, which is also used for provider discovery. Existing Referer, Origin, User-Agent and the signed adaptive master URL remain unchanged. API/embed requests do not include this internal instruction.

Discovery still performs two HTTP reads. No WebView, additional requests, retries, variant selection, subtitles or provider-specific app code are introduced.

The device log showed the root master repeatedly returning HTTP 403 via DefaultHttpDataSource, despite configured UA/Referer/Origin. A shared client removes one known transport difference; this is a focused compatibility test, not a confirmed fix for the server rejection. It does not create a browser session, add cookies, refresh tokens or guarantee the same connection/IP. PluginHttp does not configure a persistent cookie jar.

Validation: existing provider regression suite and repository validation pass. Android playback must be tested on the device. If HTTP 403 persists, this attempt does not establish a stable working VixSrc provider.
