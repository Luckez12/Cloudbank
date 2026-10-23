# VidLove v2.4.1 — video dan subtitle serentak

Gantikan providers/vidlove.js dan manifest.json pada laluan sama di repo Cloudbank, commit dan refresh VUEO. App yang sudah dipasang untuk v2.4.0 kekal; tiada APK atau YML baharu diperlukan.

## Perubahan

- Satu request senarai/link subtitle bermula bersama kumpulan pertama request video. Ia tidak memuat turun semua fail subtitle.
- Tiada lagi timeout subtitle berasingan 2.5 saat. Kedua-duanya berkongsi baki had keseluruhan provider 17.5 saat.
- Jika semua laluan video termasuk fallback website gagal, provider pulang kosong tanpa menunggu subtitle. Timer/hasil subtitle dibatalkan; runtime VUEO sedia ada membatalkan request native yang masih berjalan selepas provider selesai.
- Jika host mempunyai AbortController, signal pembatalan turut digunakan. Bridge fetch VUEO semasa tidak menyediakan pembatalan per-request melalui signal; pembatalan rangkaian di VUEO bergantung pada teardown pelaksanaan yang sedia ada.
- Jika payload video sudah mempunyai subtitle, gunakan payload itu dan buang kerja subtitle tambahan yang masih menunggu. Jika tidak, gunakan hasil request parallel.
- URL video, kualiti, semakan audio dan mekanisme tamat awal website v2.4.0 dikekalkan.

## Had masa

Parallel boleh menghapuskan penantian subtitle yang sebelum ini hanya bermula selepas video. Ia tidak menjamin masa scan tertentu. Jika subtitle tidak menjawab dan video tiada subtitle payload, provider boleh menunggu sehingga had keseluruhan 17.5 saat sebelum memulangkan video sahaja. Had ini mencegah scan tergantung tanpa memotong subtitle pada 2.5 saat.

Batal apabila carian video gagal tidak bermaksud provider memantau kegagalan playback kemudian; ketika player dibuka, tugas discovery sudah selesai.

## Ujian

6 ujian parallel lulus: mula bersama, subtitle siap dahulu tanpa kelewatan selepas video, subtitle 3.1 saat tidak dipotong, pembatalan apabila video gagal, payload diutamakan, serta pemulangan video pada had keseluruhan jika subtitle tidak siap. Suite regresi semasa, 12 ujian pemetaan, 18 ujian fallback dan validasi 36 provider turut lulus. Kelajuan sebenar pada telefon belum diukur.
