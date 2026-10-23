# VidLove v2.4.0 — pulang awal apabila respons website layak

Pasang companion patch APP-VUEO-JSON-Source-Early-Return-TV-Mobile terlebih dahulu, build dan pasang APK. Kemudian gantikan `providers/vidlove.js` dan `manifest.json` pada laluan sama dalam repo Cloudbank, commit dan refresh.

Laluan HTTP dikekalkan. Jika ia gagal, provider membuka satu sesi website seperti v2.3.1, tetapi kini menghantar peraturan tamat awal untuk jenis media, ID, musim/episod dan metadata yang diminta. Bridge baharu boleh memulangkan payload layak tanpa menunggu penuh 8 saat. Provider masih menyemak hasil sebelum dipulangkan kepada player.

Signed URL, pemilihan rendition 720p+/unknown, semakan audio dan subtitle payload dikekalkan. Tiada carian atau probe media tambahan. Tiada hardcode Masterplan, UNABOMBER atau tajuk lain.

Provider sahaja pada app lama masih menggunakan tingkah laku timeout biasa; ia tidak mengaktifkan optimasi tanpa companion bridge.

Ujian: 18 semakan fallback, 12 semakan format/kualiti/subtitle, regresi URL shim VUEO dan validasi 36 provider lulus. Bridge baharu juga lulus 28 ujian policy Kotlin dan compile fail penuh. Replay payload sebenar tiga ID mengesahkan playback URL, headers, quality, format, audio dan subtitle sama sebelum/selepas perubahan. Ini bukan ujian scan atau playback pada peranti.

Selepas build baharu, uji Masterplan dan UNABOMBER. Semak `finish=json-source`, `earlyCompletion=true` dan masa scan. HTTP masih boleh menambah masa apabila semua engine kosong. Tidak semua sumber dijamin menyokong tamat awal; timeout biasa kekal sebagai fallback.
