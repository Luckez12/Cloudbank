# Cloudbank

JavaScript stream-provider repository using the Nuvio-compatible CommonJS contract.

## Installation

Use the raw URL of `manifest.json` from **this repository's owner and branch**.
The previous VUEO-STOCK URL points to a different repository and is not the installation URL for Cloudbank.

## Provider contract

```javascript
function getStreams(tmdbId, mediaType, season, episode) {
  return Promise.resolve([]);
}
module.exports = { getStreams: getStreams };
```

`mediaType` is `movie` or `tv`. TV requests include the requested season and episode.
Streams use `name`, `title`, `url`, `quality`, optional playback `headers`, and optional `subtitles`.

Providers are distributed individually. Their CommonJS code runs in the consuming app, despite the repository's Node tooling using ES modules.
Cheerio, crypto support and `webviewResolve()` are app runtime capabilities; `npm ci` installs test copies for validation but does not inject them into the consuming app. CineMode needs native `webviewResolve()`.

## Add a provider

1. Copy `providers/_template.js` to `providers/<id>.js`.
2. Implement discovery, title/year matching, exact TV episode selection and stream extraction. Preserve the title profile and shared metadata helpers. Use runtime-compatible APIs and bounded work within the app's 20-second limit.
3. Register a unique scraper in `manifest.json` with the existing required fields, `runtimeTimeoutMs: 20000`, and `enabled: false` until playback is verified.
4. Run `npm ci --ignore-scripts`, `npm run validate`, and `npm test` with Node 20+ and Python 3.10+.
5. Test a real movie and TV episode in the consuming app, including headers/subtitles where applicable, before enabling it. Increment provider and manifest versions for changes.

Validation checks structure and module loading. Offline regression tests check shared metadata and ZIP handling. Neither proves that external websites or playback are currently working.

## ZIP patches

Use repository-relative paths such as `providers/example.js` and `manifest.json`.
A single repository wrapper containing `providers/` or `manifest.json` is also supported.
A root-level `providers/` folder remains intact. Unsafe paths, links and ambiguous ZIP selection are rejected.

The workflow uses only ZIP files added/modified by a push. For manual execution, select `zip_file` when more than one ZIP is present. It validates and tests the applied repository before committing. It does not dispatch an unrelated app build.

For the initial repair, update the workflow and its helper together before relying on the repaired ZIP automation; an uploaded patch is first handled by the workflow currently on GitHub.

## Provider collection

The first collection contains 74 providers: its original eight, 62 additional providers from All-in-One-Nuvio, and four independent V2 variants. The original Cloudbank implementations remain intact; 4KHDHub V2, HDHub4u V2, MovieBox V2 and KissKH V2 use upstream implementations with separate IDs. Future overlapping imports receive V3, V4 and so on. See [import attribution and runtime limits](docs/UPSTREAM.md) and the pinned source hashes in [upstream-import.json](docs/upstream-import.json). Imported providers remain enabled as in their source manifest; module loading and adapter tests are offline checks, not playback certification.

## Yoruix collection

The combined collection now has 103 providers. Yoruix main adds eight new providers and 21 independent variants without replacing any of the previous 74. Variant numbers continue V2, V3 etc. VidEasy V2 remains disabled as configured upstream. See [Yoruix attribution and compatibility notes](docs/YORUIX.md).
