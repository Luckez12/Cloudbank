Cloudbank XPass v2.0.0 - Current Website Flow

Pasang ke repo Cloudbank:
Upload manifest.json dan providers/ ke root repo dan gantikan fail sama.
Folder tests/ mengandungi semakan pilihan. Refresh repo/provider dalam VUEO.
Pastikan XPass menjadi v2.0.0. Tiada YML, fail perlu dipadam atau APK baharu.

Rombakan:
Provider lama membaca var backups terus daripada HTML dan mengekstrak semua
child playlist HLS secara berurutan. Website semasa mempunyai backups kosong
pada awal; senarainya datang daripada respons dataUrl bertoken dan disulitkan.

Aliran baharu:
1. Buka embed /e/movie/ID atau /e/tv/ID/season/episode.
2. Ambil dataUrl asal bertoken daripada halaman, dengan semakan route tepat.
3. Muatkan loader/player script yang dirujuk website, baca build penyulitan
   daripada string table. Tiada nama fail player/build token tetap dalam provider.
   Skrip website tidak dieval; hanya string table berkaitan dibaca.
4. SHA-256 + AES-GCM untuk menyahkod dan mengesahkan indeks server seperti website.
   Implementasi menggunakan modul crypto-js sedia ada (AES-CBC block primitive
   dan GHASH). Tag authentication wajib sah sebelum JSON digunakan.
5. Cuba server playlist maksimum tiga selari. Pulangkan sumber daripada server
   eligible pertama, tanpa menunggu semua server atau memuat turun video/segmen.
6. Kekalkan master HLS/DASH dan URL bertandatangan. Subtitle playlist dipelihara;
   endpoint subtitle berasingan yang dinyatakan halaman dicuba selari, tanpa
   melambatkan video jika masih belum siap atau gagal.

Header mengikuti Referer halaman untuk request same-origin, origin sahaja untuk
media cross-origin, serta pengecualian no-referrer website untuk hos yang ditetapkan.
Tidak meneka audio sebagai Original. Sumber yang jelas dub atau bahasa berbeza
mengikut metadata payload ditolak; audio tanpa metadata kekal tidak diketahui.
Direct file bawah 720p ditolak; master adaptive/Auto/unknown diterima.

Had:
Backend cf-master yang memerlukan interceptor k/kx khas tidak dipulangkan sebagai
link native biasa; server lain dicuba. Tiada patch VUEO atau decoder baharu dibuat.
Perubahan format penyulitan website pada masa depan mungkin memerlukan kemas kini.
Subtitle endpoint Masterplan memulangkan 404 dalam probe ini; bukan jaminan ada
subtitle untuk semua tajuk. Subtitle lambat tidak dimuatkan selepas provider tamat.

Bukti pemeriksaan 24 Oktober 2026:
Halaman Masterplan 1561726 dan skrip website sebenar dibaca. Indeks disahkan dan
dinyahsulit kepada sembilan server; JSON playlist pertama mempunyai sumber HLS.
Master HLS dibaca dengan HTTP 200 dan kandungan #EXTM3U. Video/segmen penuh tidak
diuji dan trek audio sebenar belum disahkan.

Ujian:
10 ujian cipher/tamper/filter/payload dan 3 ujian pipeline filem/TV/ID tidak sah
lulus. Pipeline TV turut menggunakan shim URL VUEO. Probe respons website sebenar
menggunakan decoder yang sama. npm run validate lulus untuk 36 provider.
Tests menggunakan payload sintetik; tiada signed URL/token sesi sebenar disertakan.
Main balik APK pada peranti belum diuji.
