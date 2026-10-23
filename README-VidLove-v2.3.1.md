# VidLove v2.3.1 — pembetulan timer WebView

Gantikan providers/vidlove.js dan manifest.json di repo Cloudbank, commit dan refresh VUEO. Log mesti menyebut v2.3.1. Tiada perubahan app atau YML.

## Masalah yang dibetulkan

v2.3.0 memberi timeout kepada sesi WebView dan pada masa sama menamatkan await JavaScript selepas timeout + 200 ms. Timer WebView native bermula selepas persediaan/loadUrl. Overhead persediaan dan pemulangan hasil boleh melebihi 200 ms, lalu provider membuang hasil sebelum native sempat memulangkannya. Log telefon menunjukkan sesi dibatalkan sekitar 8.2 saat selepas dimulakan.

v2.3.1 membuang timer JavaScript yang bertindih untuk panggilan WebView. Timer sesi native kekal sehingga 8 saat; wrapper provider sedia ada kekal pada 19 saat untuk mengehadkan jumlah pelaksanaan. Ruang 2 saat diperuntukkan semasa mengira baki bajet sesi. Tambah WEBSITE_STATE dengan sebab tamat, document-start hook, status page-finished dan bilangan respons. Tiada token atau URL media dilog.

Request API native tidak diubah lagi. Jika native berjaya, WebView tidak dibuka. Jika semua engine gagal, satu sesi website cuba ID/episod yang diminta. Tiada peraturan khusus Masterplan, UNABOMBER atau mana-mana ID lain.

## Bukti dan batas

- Ujian masa simulasi memberikan hasil native selepas 8.5 saat, berbanding had JavaScript lama 8.2 saat. Kod v2.3.0 gagal ujian ini; v2.3.1 lulus.
- 17 semakan fallback, 12 semakan format/kualiti/subtitle dan suite URL shim/regresi semasa lulus.
- npm run validate: 36 provider lulus.
- Ini membetulkan kelemahan timer provider. Ia belum membuktikan punca API telefon memulangkan metadata/sumber kosong atau memastikan playback Android kembali berjaya.
- Fallback boleh menunggu sehingga timeout sesi, ditambah overhead native. URL media tanpa sambungan fail mungkin tidak menyebabkan sesi tamat awal dalam bridge semasa.

Uji semula Masterplan dan UNABOMBER. Jika masih gagal, log WEBSITE_STATE kini menunjukkan keadaan sesi yang sebelum ini hilang apabila timer JavaScript tamat.
