Cloudbank VidLove v2.7.0 - Subtitle Grace 1 Second

Pasang ke repo Cloudbank sahaja. Upload manifest.json dan providers/ ke root
repo, gantikan fail sama, kemudian refresh repo/provider dalam VUEO.
Tests/ adalah semakan pilihan untuk repo. Tiada YML atau fail perlu dipadam.
Tiada patch atau APK VUEO baharu diperlukan untuk perubahan provider ini.

Video dan subtitle mula selari. Selepas link video siap, jika request subtitle
masih berjalan, tunggu tambahan maksimum 1000 ms, tertakluk baki deadline asal.
Jika subtitle siap awal atau gagal, terus pulangkan video. Jika tiada video,
request subtitle dibatalkan tanpa masa tambahan. Tiada retry tambahan.

Maksimum 5 English + 5 Malay; URL pendua dibuang. Jika hanya sedikit yang ada,
pulangkan jumlah tersedia tanpa menunggu kuota penuh. Payload yang sudah cukup
5+5 tidak menunggu request subtitle lain. Request yang belum siap dibatalkan
apabila provider memulangkan hasil. Tiada deferred subtitle API.

Log baharu: en, ms, status, waitedAfterVideoMs dan graceMaxMs.
Video boleh menunggu sehingga satu saat tambahan berbanding v2.6.0.
Had trek mengecilkan hasil; ia tidak mengecilkan respons endpoint subtitle.

Patch ini tidak mengubah pemilihan MP4/HLS atau membaiki HTTP 403.
Subtitle yang mengambil masa lebih lama masih boleh tiada selepas had tamat.

Semakan lulus: 6 grace checks, 11 parallel checks, 12 website mapping checks,
18 browser fallback checks, suite current provider dan validasi 36 provider.
Ujian ialah simulasi respons/masa, bukan pengesahan playback pada peranti.
