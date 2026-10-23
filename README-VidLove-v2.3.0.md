# VidLove v2.3.0 — fallback website untuk semua tajuk

## Pasang

Ekstrak ZIP. Gantikan `providers/vidlove.js` dan `manifest.json` pada laluan sama dalam repo Cloudbank. Commit, kemudian refresh repo/provider di VUEO. Log mesti menyebut v2.3.0. Tiada perubahan app atau YML.

## Punca dan bukti

TMDB 1492640 ialah UNABOMBER. Website memainkan tajuk ini melalui Barbarian King/MovieBox; video browser readyState=4, paused=false dan masa bergerak. Request HTTP audit dengan profil website juga memulangkan sumber MovieBox, metadata ID 1492640 dan qualities MP4 1080p/480p/360p. Sebaliknya log telefon v2.2.0 menunjukkan kelima-lima engine kosong.

Perbezaan respons telefon belum berjaya direplikasi secara tepat. Jangan anggap tajuk tiada, atau punca tepat ialah satu header tertentu. Runtime VUEO yang diperiksa meneruskan Origin, Referer, User-Agent dan query; tiada bukti ia membuang ID.

## Perubahan

- Laluan HTTP v2.2.0 dikekalkan. Jika sumber layak ditemui, WebView tidak dibuka.
- Jika semua laluan native gagal, satu sahaja sesi website dibuka pada `/embed/movie/<id>` atau `/embed/tv/<id>/<season>/<episode>`.
- Baca respons API JSON daripada sesi website menggunakan bridge terperinci yang sudah ada. Semak origin API, jenis media, ID, musim/episod dan metadata sebelum memetakan sumber.
- Gunakan pemetaan format, kualiti dan audio yang sama. Tiada ID/tajuk produksi dimasukkan dalam kod. Pilihan diketahui bawah 720p dan dub-only yang dinyatakan ditolak; kualiti/audio yang tidak dinyatakan kekal tidak disahkan.
- Kekalkan URL bertandatangan dan subtitle payload. Header media yang diperhatikan hanya boleh disalin untuk sumber yang sepadan dan rendition pada origin sama.
- Tiada fetch subtitle native tambahan selepas fallback browser. Ini mengelakkan mengulang laluan native yang mungkin bermasalah; subtitle kosong tidak dianggap berjaya.
- Log `API_RESPONSE` menambah status serta kewujudan metadata/sumber tanpa mendedahkan URL media atau token.

## Had masa dan keserasian

Jika bridge tersedia, fasa native dihadkan 6 saat; sesi website maksimum 8 saat. Jumlah dalaman dihadkan 17.5 saat, di bawah wrapper 19 saat. Native yang cepat berjaya tidak menanggung kos browser. Bridge memerlukan `sessionResponseVersion=1` dan captured JSON; versi lama yang tidak menyokongnya akan dilog sebagai tidak tersedia.

Bridge semasa mungkin menunggu sehingga timeout bagi URL media tanpa sambungan fail. Oleh itu fallback boleh menambah sehingga 8 saat; tiada jaminan kelajuan atau playback Android sebelum ujian peranti.

## Ujian

- `node tests/vidlove-current.cjs`: regresi termasuk URL shim sebenar VUEO lulus.
- `node tests/vidlove-website.cjs`: 12 semakan format/kualiti/subtitle lulus.
- `node tests/vidlove-browser-fallback.cjs`: 16 semakan fallback, ID/episod salah, status gagal, dub-only, resolusi rendah, isolasi cookie, kegagalan bridge dan laluan native pantas lulus.
- Replay payload sebenar UNABOMBER melalui provider penuh dengan native dipaksa kosong: satu sesi fallback, satu sumber MP4 1080p. Payload audit ini tidak menyertakan subtitle HTTPS.
- `npm run validate`: 36 provider lulus.

Browser desktop mengesahkan tajuk tersedia dan boleh dimainkan. Sesi WebView VUEO dan playback fallback pada telefon belum disahkan. Uji UNABOMBER dahulu, kemudian semak Masterplan masih menggunakan laluan native yang berjaya.

ZIP tidak mengandungi URL media bertandatangan, token, payload audit sebenar atau perubahan app.
