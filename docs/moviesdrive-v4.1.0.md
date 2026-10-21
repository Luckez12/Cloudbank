# MoviesDrive 4.1.0 — H.264 preference and quality alternatives

Cloudbank manifest 1.20.62; 42 active providers. All earlier removals remain in effect.

## Problem

The uploaded VUEO performance capture recorded two HEVC decoder failures on a TECNO KM9, using `c2.mtk.hevc.decoder`. The 10-bit stream exceeded reported capabilities; the 8-bit stream was reported supported but still failed. The capture did not include a provider version or discovery scan. It does not establish that every HEVC stream is unplayable, or that H.264 guarantees playback.

## Changes

- Prefer source blocks explicitly labelled H.264/x264 over HEVC/x265, including an available 720p H.264 file ahead of a 1080p HEVC file.
- Keep higher-bit-depth labels behind lower-risk options. Bit depth comes from a source label, not a decoded stream profile.
- Retain up to three validated choices, with different resolutions/codecs preferred over repeated encodes of the same format. HEVC remains available if the website offers it.
- Extend the bounded Range probe from 1 KiB to 8 KiB. The real sampled MKV files place their video CodecID around byte 4335. Detect `V_MPEG4/ISO/AVC` and `V_MPEGH/ISO/HEVC` when present. These are container declarations, not proof that frames can decode.
- Let detected container codec override a conflicting label. Unknown remains unknown, with an explicit codec label in the UI. Do not infer H.264 merely from an MKV/MP4 extension or resolution.
- Show H.264 / HEVC / Codec unknown on each source so the user can choose an alternative.
- Return valid sources already found when a later alternate request fails or times out. Previously, the provider stopped after one valid file.
- Suppress duplicate signed URLs referring to the same origin/path, and equivalent quality/codec choices.
- Limit extra alternate collection to 5.5 seconds after the first validated source, within the unchanged 18.7-second total budget. Do not wait indefinitely for alternatives.

The provider does not transcode files, change VUEO's decoder, or automatically switch playback after a codec error. If a title only offers HEVC, it cannot manufacture a H.264 version. Users select returned alternatives in VUEO.

## Retained behavior

Current domain-map/fallback route, exact title/year-or-IMDb/season/episode matching, ZIP/episode-pack rejection, minimum 720p, original/dual-including-original/unknown audio acceptance, media Range validation, real size, embedded track preservation and no signed media URL caching remain active.

No app or YML changes and no deletion scripts. DooFlix, HDGharTV, HindMoviez, AllMovieLand, CineFreak and CinemaCity remain absent from the manifest. MovieBox remains 3.0.1.

## Verification

24 fixture checks pass, covering the existing matching/audio/episode checks plus:

- H.264 quality ordering and preserved HEVC alternatives;
- quality diversity before duplicate encodes;
- known H.264/HEVC codec IDs and honest unknown handling;
- returning validated 1080p/720p H.264 and HEVC choices with visible codec labels;
- retaining good sources after an alternate fails;
- Range/signature rejection and runtimes lacking `arrayBuffer`;
- no signed query tokens in provider logs.

The current parser also passes against previously captured real MoviesDrive search/post/archive/HubCloud pages. Its 8 KiB codec detection matches ffprobe on the real movie H.264 sample and Korean-series HEVC sample. Those sample files previously passed HTTP 206 and MKV/header checks; this does not confirm this new build's playback on the user's device.

Run:

```sh
node tests/moviesdrive-website.cjs
npm run validate
```

After applying, test a source visibly marked H.264 first and send the VUEO log if it still fails. Provider logs now include `ROUTE: v4.1.0` to disambiguate builds.
