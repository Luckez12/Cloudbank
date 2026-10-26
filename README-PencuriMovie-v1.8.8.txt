Extract over Cloudbank repository root. No VUEO changes.

Removes first-source 400ms cutoff. All mirrors start concurrently and each has
its own 6.5s extraction limit; completed sources returned after mirrors settle
or time out. One source no longer cancels the next mirror. Can wait longer than
v1.8.7 when a mirror hangs. No scan-time or server-count guarantee.

HTTP GET page promises reused by URL and header context for the current scan.
Specialized and generic parsers reuse identical fetched pages and errors.
Cache resets at scan start; no cross-scan signed media cache. Page request/body
read timeout 3.5s; abort where supported. Mirror limit ignores late results;
remaining requests end with runtime/provider completion. No playlist/media,
segment, range or seek probes. No legacy rescan fallback.

Playmogo is a Dood host and now uses existing Dood parser when normal source
fields are available. Live sample currently returns a verification challenge;
no challenge solver added. Streamtape sample returned Site Unavailable; VOE
sample returned 404. HGCloud loader JavaScript returned 403 here, so existing
HGCloud fallback preserved rather than inventing a redirect/API. Those host
restrictions are not claimed fixed. Existing headers/server labels retained.
No subtitle work or VUEO edits.

21 regression checks pass; manifest validates 25 providers. Includes second
mirror finishing after 500ms, hanging mirror timeout, shared GET, and Dood host
mapping. Source playback and current device timings remain untested.
