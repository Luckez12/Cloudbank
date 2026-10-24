# Patch 1Shows v1.1.0 + empat provider dibuang

Ekstrak kandungan ZIP di root repo Cloudbank (sebelah `manifest.json`). Jangan letakkan keseluruhan ZIP dalam folder `providers/`.

## Pemasangan

1. Terapkan ZIP melalui aliran patch sedia ada atau ekstrak ke root repo.
2. Untuk padam fail lama secara fizikal, jalankan `node scripts/retire-selected-providers.cjs` dari root repo. Pilihan melalui telefon: selepas ZIP diterapkan, buka GitHub Actions → **Remove selected retired providers** → **Run workflow** pada branch `main`.
3. Manifest baharu sudah mengeluarkan StreamFlix, FibWatch, OnlyKDrama dan YFlix. Vidnest dan Mapple dikekalkan.
4. Refresh repo/provider dalam VUEO dan uji 1Shows.

## Perubahan 1Shows

- Ikut aliran API sebenar: download-token → download/movie atau download/tv → AES-256-GCM dengan token sebagai authenticated data → resolver host → pemeriksaan media.
- Kemas kini public client decoder mengikut WASM laman semasa `makimaDL.8f94222afb4794c1`; laluan utama berjalan dengan JavaScript biasa tanpa Node crypto, WebCrypto atau WebAssembly. Pengesahan tag GCM dikekalkan.
- Tambah pautan gateway HubCloud semasa. Resolver host lama dikekalkan.
- Kegagalan satu resolver tidak menggagalkan semua sumber. Had masa HTTP/API dan resolver mengelakkan menunggu tanpa had.
- Pemeriksaan rangkaian gagal, status HTTP ralat atau HTML bukan lagi dianggap video. Fail video diperiksa dengan HEAD untuk mengelakkan muat turun seluruh filem; HLS mesti mengandungi `#EXTM3U`. Host yang menolak HEAD mungkin tidak dikembalikan.
- Kekalkan penapis tahun filem sebelum dan selepas resolve; tahun episod TV tidak dibandingkan dengan tahun mula siri.
- Tiada perubahan pada nama atau bahasa subtitle.

## Pengesahan dan batasan

- Respons API sebenar sampel movie TMDB 1236045 telah dibuka kepada 33 calon sumber menggunakan decoder laman semasa; tiga calon jelas bertahun 2023 untuk filem lain. Calon sumber bukan pengesahan playback.
- Public decoder constant disahkan menggunakan tag GCM respons sebenar. Ujian portable JavaScript berasingan mengesahkan decrypt, token/AAD dan penolakan tag diubah.
- Ujian resolver berasingan mengesahkan kegagalan host tidak menutup hasil host lain, penolakan HTML/status ralat dan pemeliharaan header playback.
- Semakan langsung susulan dari persekitaran ujian mendapat timeout API dan sebahagian host. Tiada pautan video akhir atau playback Android yang berjaya disahkan untuk patch ini. Uji pada peranti sebelum menandakan 1Shows selesai.
- `npm run validate`: 32 providers. Ujian `tests/1shows-current-api.cjs` dan `tests/retire-selected.cjs` lulus.

Fail patch: `providers/1shows.js`, `manifest.json`, `scripts/retire-selected-providers.cjs`, `.github/workflows/retire-selected-providers.yml`, dua fail ujian, `DELETE_FILES.md`, dan dokumen patch ini. Fail provider yang dibuang tidak dibundel semula.
