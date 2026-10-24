# Cloudbank — senarai delete dan giliran semakan

Dikemas kini 24 Oktober 2026. Asas: ZIP Cloudbank-main (11), kod dalam workspace dan patch StreamFlix sesi ini. Semakan statik ringkas untuk triage; tiada audit langsung semua laman atau pengesahan playback baharu. Nombor versi, kod import atau obfuscation sahaja bukan bukti outdated. Rekod sejarah tidak lengkap: “tiada bukti pembaikan khusus” bukan “pasti tidak pernah dibaiki”.

## Senarai untuk delete

- StreamFlix v1.1.0 — keputusan pengguna: masukkan dalam senarai delete dahulu. Belum dipadam atau dinyahaktifkan dalam manifest. Katalog/config hidup; Wasabi NoSuchBucket, log Android bb NXDOMAIN; tiada sumber berfungsi disahkan.

## Giliran baiki / semak

| Giliran | Provider | Versi | Bukti dan status |
|---|---|---|---|
| 1 | Vidnest | 2.2.0, playback dilaporkan berjaya; subs menunggu ujian VUEO | decryptAesGcm membaca process.env tanpa guard, bergantung aesdec.nuvioapp.space; passphrase dan server list statik; validateStreamUrl menerima 403 dan melangkau HLS. Risiko keserasian runtime/URL tidak terbukti. Import tanpa rekod pembaikan khusus dalam snapshot. |
| 2 | Mapple | 2.0.0 candidate; ujian VUEO belum selesai | solvePow sehingga 50 juta iterasi segerak; boleh menahan event loop dan timer adapter. parseHlsMaster menolak playlist media tanpa EXT-X-STREAM-INF. Manifest merekod adapter/fallback crypto, belum resolver overhaul. |
| 3 | FibWatch | 1.0.4 | bestMatch menambah -0.2 sahaja untuk tahun salah: tajuk tepat masih melepasi ambang; padanan substring turut diterima. Tiada penapisan movie/TV dalam bestMatch, selector HTML/AJAX khusus memerlukan semakan semasa. |
| 4 | OnlyKDrama | 1.0.4 | extractCandidateUrls hanya URL mutlak onlykdrama.shop; episod dikunci regex new5.filepress.wiki; titleLooksRelevant menerima satu perkataan bagi tajuk pendek. Risiko domain/parser lapuk dan padanan lemah, belum dibuktikan laman telah berubah. |
| 5 | YFlix | 1.0.3 | DB, encode, decode dan parse HTML bergantung enc-dec.app; AJAX dikunci 1moviesz.to. Perlu semak sama ada aliran dependency masih sepadan laman; tiada bukti live bahawa ia mati. |
| 6–12 | 1Shows, DesiFlix, Cineby, MoonFlix, ZinkMovies, MovieBlast, PlayIMDB | 1.0.4 / 1.0.4 / 1.9.6 / 1.0.4 / 1.0.4 / 1.0.5 / 2.0.4 | Nota manifest majoritinya import dan adapter. Banyak core obfuscated. Belum ada kecacatan khusus yang disahkan melalui triage ini; giliran semakan sahaja. MovieBlast pernah consolidation/fallback, jangan label belum pernah disentuh. |

## Sudah ada rekod pembaikan khusus — tidak automatik masuk giliran rombak

KissKH 1.4.0; OneTouchTV 1.5.0; HDHub4u 1.7.0; MovieBox 3.0.1; 4KHDHub 1.9.0; PencuriMovie 1.8.6; MSM21 1.7.6; CineMode 1.3.5; Castle 2.2.0; MoviesDrive 4.2.0; Movies4u 2.1.0; Movix 1.1.0; VidRock 4.0.0; VidLink 1.1.0; VidSrc 3.2.1; VixSrc 2.0.2; VidFast 2.0.0; VidLove 2.8.0; XPass 2.0.0; CineVibe 2.0.0; KShow123 1.0.2; VidZee 1.0.3; VidSrc.to 1.0.2.

Rekod patch bukan bukti playback semua tajuk. MovieBox menunggu log diagnostik 1080p; KissKH pernah ditangguh kerana laporan laman down; VidLink/VidSrc bergantung companion bridge tertentu; VidFast capture/playback belum disahkan. OneTouchTV ada satu sampel lulus device dalam docs/provider-review-queue.md; MoviesDrive mempunyai bukti device v4.1.0, bukan automatik v4.2.0.

## Giliran seterusnya

Vidnest v2.0.1 disediakan menggunakan new.vidnest.fun dan decrypt v2 setempat. Ujian penuh HTTP sebenar menghasilkan satu sumber VidZee MKV HTTP 200 untuk Venom 2; playback Android belum disahkan. API My Demon S1E3 membalas 502. Tunggu log VUEO sebelum Mapple. Tidak meneruskan StreamFlix atau membuang provider lain secara automatik. Senarai lama mengandungi nama yang sudah tiada dalam manifest: AllMovieLand, CineFreak, CinemaCity, DooFlix, HDGharTV, HindMoviez, MoviesHunt, NetMirror, VidEasy, Peachify, VegaMovies; jangan jadikan ia giliran fail sedia ada tanpa semakan identiti dahulu.

Vidnest v2.0.0 device regression: runtime crypto lacks algo.AES. v2.0.1 isolates CryptoJS primitives inside provider; tests forbid all external module access. Await new device log; no playback success inferred.

Vidnest v2.0.1: pengguna mengesahkan boleh play (tiada log first-frame baharu). v2.1.0 menambah subs English/Melayu sahaja; VDRK v1 untuk TMDB 1148365 mempunyai 8 English + 1 Malay, fail English/Malay HTTP 200 dan format sah. Tunggu ujian handoff sari kata VUEO.

Vidnest v2.1.1 device evidence TMDB 1236045: two media sources ready by 1668ms, nine EN/MS captions forwarded, VIDEO_FIRST_FRAME and SUBTITLE_CUES_DELIVERED observed. Scan waited 10.1s for FlixHQ timeout. v2.2.0 changes collection/cancellation only; wait for device timing confirmation.

Vidnest v2.2.0: log 14:19:54 mengesahkan tiga scan 970/3107/882ms, first-frame dan cues subs. Mapple v2.0.0: endpoint sesi semasa dikenal pasti dan patch disediakan; browser laman memainkan Animals 1080p, tetapi standalone HTTP timed out pada initial page. Tunggu log VUEO, jangan label playback provider lulus.
