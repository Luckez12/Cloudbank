Cloudbank VidLove v2.8.0 - Adaptive Master + Selected Source Headers

Pasang ke repo Cloudbank sahaja:
1. Upload manifest.json dan providers/ ke root repo, gantikan fail sama.
2. Folder tests/ mengandungi semakan provider untuk repo.
3. Refresh repo/provider dalam VUEO; pastikan versi menjadi 2.8.0.
Tiada YML atau fail perlu dipadam. Tiada APK baharu diperlukan.

Pembaikan video:
- Master HLS/DASH yang sah dikekalkan walaupun source.qualities mengandungi MP4.
- URL bertandatangan dikekalkan tepat tanpa dibina semula.
- Jika tiada adaptive parent yang sah, pemilihan rendition sedia ada digunakan.
- Untuk rendition pada origin sama, header API parent digabungkan dengan header
  rendition; header rendition menang tanpa menduakan nama berlainan huruf besar.
- Rendition origin berlainan tidak mewarisi credentials parent.
- Header pemerhatian browser hanya disalin daripada URL pilihan yang tepat.
- Header browser digabungkan dengan header API supaya header API lain tidak hilang.
- Tiada request probe media, retry video atau pertukaran server baharu ditambah.

Subtitle v2.7.0 termasuk dalam patch ini:
Request selari; selepas link video siap tunggu maksimum satu saat tambahan,
tertakluk baki deadline asal. Maksimum 5 English + 5 Malay, URL pendua dibuang.
Senarai siap awal dipulangkan segera walaupun kurang daripada kuota.
Tiada deferred subtitle API atau perubahan VUEO.

Had pengesahan:
Punca tepat HTTP 403 server belum dapat disahkan. Patch membaiki pemilihan
sumber dan pengendalian header yang dikenal pasti pada kod, bukan jaminan semua
MP4 akan bebas 403. Sumber direct-only masih boleh mendapat 403 daripada server.
Ralat label diagnostik subtitle configured/rejected dalam VUEO belum diubah.

Semakan lulus: 10 selection/header, 20 browser fallback, 12 website mapping,
6 grace, 11 parallel subtitle checks, suite current provider dan validasi repo
36 provider. Ujian menggunakan payload/sesi simulasi termasuk shim URL VUEO.
Main balik sebenar pada peranti belum diuji.
