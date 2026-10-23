# VidLove v2.2.0

Patch untuk Cloudbank-main (10).zip. Tiada perubahan app atau fail YML.

## Pasang melalui GitHub browser

1. Ekstrak ZIP ini.
2. Upload `providers/vidlove.js` ke folder `providers` dan gantikan fail lama.
3. Upload `manifest.json` ke root repo dan gantikan fail lama.
4. Commit, kemudian refresh repo/provider di VUEO. Semak log menyebut `v2.2.0`.
5. Uji Masterplan (TMDB 1561726) dan Spider-Man: Brand New Day (TMDB 969681).

Fail tests dan nota ini pilihan untuk disimpan; kedua-duanya tidak diperlukan ketika playback.

## Pembaikan

- Ikut modul website `c-vlstart5-2d0b7502e3a3.js`: `Origin: https://player.vidlove.cc` pada API dan `vh=1` untuk moviebox/moviebox2. Tidak memaksa HEVC.
- Baca `source.qualities` dan jenis `mp4` bagi URL MovieBox tanpa sambungan fail. Pilih kualiti tertinggi yang layak, dengan H.264 diutamakan. Tolak pilihan diketahui bawah 720p; Auto/unknown dibenarkan.
- Kekalkan semakan audio: dub-only yang dinyatakan ditolak. Audio yang tidak dinyatakan tidak disahkan sebagai original.
- Kekalkan URL bertandatangan; tiada permintaan media/segmen tambahan dalam provider.
- Had trek subtitle dinaikkan 32 ke 128 supaya Malay tidak terpotong. Label bahasa dikekalkan; trek bukan HTTPS diabaikan.
- Had keseluruhan, lima engine dan maksimum tiga request serentak dikekalkan. MovieBox, VidAPI dan MovieBox2 dicuba dalam kumpulan pertama.

## Bukti dan batas ujian

- Browser: Masterplan dan Spider-Man sedang main melalui Barbarian King; video readyState=4 dan masa playback bergerak.
- HTTP perbandingan Masterplan: request lama moviebox tanpa vh=1 kosong; request website dengan Origin dan vh=1 memulangkan metadata ID 1561726, sumber MovieBox serta qualities 1080p/480p/360p. Ini bukti sesi audit, bukan jaminan semua rangkaian memberi respons sama.
- Payload sebenar Masterplan dipetakan kepada MP4 1080p, 66 trek HTTPS termasuk Malay. Payload VidAPI Spider-Man dipetakan kepada HLS Auto.
- Provider penuh melalui HTTP sebenar: kedua-dua tajuk mendapat satu HLS Auto daripada VidAPI; permintaan subtitle berasingan tamat masa. Jangan anggap subtitle sentiasa berjaya.
- Semakan media melalui HTTP audit menerima 403. Playback browser disahkan, tetapi playback VUEO/Android belum disahkan.
- `node tests/vidlove-website.cjs`: 12 semakan lulus.
- `npm run validate`: 36 provider lulus.

Tiada link media bertandatangan atau token dimasukkan dalam ZIP. Ujian menggunakan data tiruan dengan struktur payload sebenar.
