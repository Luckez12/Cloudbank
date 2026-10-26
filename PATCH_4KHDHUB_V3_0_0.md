# 4KHDHub 3.0.0

Replaces the previous 2.0.4 engine with a WATCH-only flow: shared metadata (TMDB fallback when unavailable), exact website title/year/type search, one matching detail page, exact published Videasy/AutoEmbed iframe, capture media URL and available English/Malay subtitles, return.

Removed: all download gate/HubCloud/HubDrive/file-host crawling, download workers, binary HEAD/Range probes, repeat playlist validation GET, unsupported captured-playlist body reuse, old display wrapper. Server metadata uses both server and serverName. No subtitle-only fetches or added subtitle wait. Captured session headers are preserved except request-specific headers unsuitable for playback. Results honestly declare sourceVerified=false and playbackVerified=false.

Player still requires the existing VUEO WebView bridge: unlike HDHub4u WATCH, the known Videasy route does not expose its resolved stream in the website HTML used by this provider. No verified direct HTTP API was established. Stream capture uses the prior waitForMediaReady=false / finishAfterFirstMs=0 behavior; browser timeout 6.5s, HTTP 4s each, overall 12s. No guarantee of a sub-5-second result. Website initially supplies one iframe; no invented second player or mirror is added.

Validation: mocked iframe/movie matching, wrong ID rejection, preserved session headers, English/Malay filter, no media/subtitle/download HTTP requests, two website requests when shared metadata is present. 25 providers validate. Legacy download-test entry points now redirect to current WATCH tests. Live site fetch from this environment timed out at proxy connection, so device playback/live website layout has not been reverified. Existing website selector and exact iframe guard retained.

Expected speed saving: eliminates the separate media validation request seen taking about 1.7s in the user's previous log. Actual savings depend on each session. Removing verification means captured URLs are handed to the player without proving playlist validity; it does not guarantee playback or CDN speed.

VUEO unchanged. No YAML files.
