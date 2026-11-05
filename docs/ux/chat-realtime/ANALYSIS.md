# Chat realtime: analisis awal

## Ruang lingkup dan basis

- Worktree: `/home/ricii/gabut/orchestrator-agent/.data/worktrees/1c4014c6-0a12-4fd9-96fa-b74f6bf8bed6`
- Baseline yang dianalisis: `91b73e5a0f10b8855d6d48ba6ecaa0260250c7af`.
- Hanya source read-only ditelusuri; semua tambahan berupa laporan, script harness, log sintetis, dan screenshot di folder artefak ini. Tidak ada provider/model, akun pengguna, prompt, data privat, atau tab kantor yang disentuh.
- Baseline ini mendahului pekerjaan review-highlight pada app/model dan preview server/formatter di worktree lain. Temuan ini perlu dicocokkan ulang terhadap perubahan tersebut sebelum implementasi.

## Ringkasan

UI sudah memakai SSE untuk event realtime. Polling state 5 detik adalah jalur tambahan: ia mengambil `/api/state`, bukan transcript. Klien SSE mengambil event global berurutan dengan cursor database, menyimpan event per task, lalu merender transcript. Apache dipasang dengan `flushpackets=on` dan server mengirim komentar heartbeat setiap 15 detik. Karena itu gejala “harus refresh” tidak dengan sendirinya menunjukkan bahwa sistem memakai polling atau bahwa WebSocket diperlukan.

Harness browser mengonfirmasi dua mekanisme fault yang terpisah: polling state tidak memperbaiki transcript yang kehilangan event text, dan reload penuh dapat menerima ulang event tersebut tetapi menolaknya dari cache. Mekanisme cache yang kedua adalah cacat yang dapat direproduksi pada baseline ini. Ini membuat insiden pengguna masuk akal, tetapi root cause insiden tetap belum diketahui karena tidak ada payload/log sesi pengguna yang diperiksa. Half-open stream juga direproduksi secara terisolasi; belum dibuktikan terjadi pada pengguna.

## Alur dan bukti kode

1. **Provider → event engine.** Claude meneruskan `stream_event` text delta sebagai event `text`, lalu event assistant lengkap sebagai `message`; Codex meneruskan `item/agentMessage/delta` sebagai `text` dan `item/completed` sebagai `message`. Tool, hasil tool, error/log, usage, dan hasil akhir juga dicatat. Bukti: `src/adapters/claude.ts` sekitar baris 22–45; `src/adapters/codex.ts` sekitar 28–43; `src/engine.ts` sekitar 28, 179–215.
2. **Event tersimpan.** `Engine.event` menyimpan event ke Store sebelum memancarkan emitter. Store memberi ID integer global SQLite dan `createdAt`; `events(after, taskId?)` mengembalikan urutan ID naik. Bukti: `src/engine.ts` sekitar 28; `src/store.ts` sekitar 40–53.
3. **HTTP SSE.** `GET /api/events?after=N` mengirim `text/event-stream`, replay semua event global setelah cursor per batch 500, menulis `id` dan JSON `data`, lalu mendengarkan event baru. Heartbeat komentar tiap 15 detik. Penutupan response membersihkan listener/timer. Bukti: `src/server.ts` sekitar 73–92.
4. **Proxy lokal.** Apache vhost menggunakan `ProxyPass ... timeout=60 flushpackets=on`; heartbeat 15 detik lebih pendek dari timeout idle proxy. Bukti: `deploy/kantor.test.conf` baris 17–18. Skrip `deploy/verify-proxy.mjs` memverifikasi stream sintetis/heartbeat dan konfigurasi, bukan latency provider atau tab nyata.
5. **Browser stream dan recovery.** `web/app.ts` memulai stream setelah `refresh()` dan pemuatan transcript awal (baris 528). Klien membaca frame SSE, mengabaikan ID lama, memajukan cursor global, menyimpan event, menjadwalkan render untuk task aktif dan refresh state untuk event status tertentu (352–375). Saat stream gagal/berakhir, retry dilakukan setelah 1,5 detik. Ketika tab kembali terlihat, listener hanya memanggil refresh state dan usage (533–535); tidak memaksa reconnect stream.
6. **Cache/transcript.** `cacheEvent` menggabungkan potongan `text` berurutan, mempertahankan paling banyak 24.000 karakter dalam satu rangkaian, membatasi cache ke 300 event kecuali histori diperluas, dan membuang delta lama saat event `message` penuh tiba (216–227). `loadEvents` meminta 300 event non-`text` terbaru (Store `recentEvents`, 49–53) dan menggabungkannya dengan cache; delta yang lebih baru dari message terakhir dipertahankan (330–337). Histori lama dipaginasi 300 event non-text melalui `before` (339–350). `chatEntries` merender `text` dan `message` sebagai bubble assistant serta event tool/log sebagai aktivitas (web/chat.ts 16–49).

## Potensi masalah yang ditemukan

- **Reconnect tab tersembunyi / half-open (mekanisme terverifikasi di fixture).** Reconnect hanya berjalan sesudah `reader.read()` selesai, gagal, atau stream ditutup. Harness menahan stream tetap terbuka, menjatuhkan text, dan mengirim visibility transition; status polling terbarui tetapi transcript tetap tidak. Keyakinan tinggi untuk kondisi half-open yang disuntikkan; belum diketahui apakah koneksi pengguna pernah berada dalam keadaan itu. Perilaku freeze/background alami tetap bergantung browser/network.
- **Delay wajar polling state.** Timer 5 detik hanya untuk state. Jika SSE bermasalah, task status mungkin tampak terlambat sampai refresh berikutnya; transcript tetap bergantung SSE atau pemuatan transcript eksplisit. `refresh()` hanya merender bila JSON state berubah (`web/app.ts` 75–81), bukan mengambil event chat. Keyakinan tinggi sebagai perilaku implementasi; belum tentu sumber kejadian.
- **Replay text dibuang oleh high-water mark cache (mekanisme terverifikasi).** `loadEvents` mengambil 300 event non-text terbaru, sehingga cache dapat berakhir pada status dengan ID lebih tinggi daripada text yang absen (`web/app.ts` 330–337). SSE kemudian replay dari cursor `0` saat reload. `cacheEvent` menolak semua event dengan ID `<= events.at(-1).id` sebelum memeriksa apakah ID tersebut benar-benar ada di cache (`web/app.ts` 216–227). Harness menghilangkan text ID `3`, mengirim status ID `4`, lalu reload. Browser menerima ulang ID `3`, tetapi transcript tidak menampilkannya karena high-water ID `4`. Jadi full reload tidak selalu memperbaiki teks yang terlewat; ini lebih spesifik daripada dugaan awal “manual refresh pulihkan”. Keyakinan tinggi untuk mekanisme pada baseline ini; hubungan ke kejadian nyata belum diketahui.
- **Pemotongan teks panjang dalam cache (risiko terverifikasi, relevansi gejala rendah).** Rangkaian delta text yang belum ditutup `message` dibatasi ke suffix 24.000 karakter; ini kehilangan awalan dalam bubble berjalan untuk output sangat panjang. Event `message` lengkap atau transcript fetch dapat menggantikannya. Tidak menjelaskan kasus umum “muncul setelah refresh”.
- **Cursor tidak memakai header `Last-Event-ID`.** Klien memakai query `after` dan cursor hanya di memori halaman. Reload memulai dari 0 lalu replay seluruh stream; cache transcript menghindari duplikasi pada UI. Ini menambah replay saat reload tetapi tidak tampak sebagai event hilang. ID query divalidasi backend.
- **Filtering/pagination.** Endpoint transcript sengaja mengecualikan event `text` dan mengambil 300 event non-text terbaru; potongan teks realtime dipertahankan dari cache. Muat lebih lama juga mengecualikan delta. Pada percakapan panjang, bila cache delta hilang dan tidak ada `message` penuh untuk menggantinya, transcript dapat kurang lengkap. Tidak ditemukan bukti query menghilangkan event yang tersimpan dalam pagination normal.
- **Race fetch transcript vs SSE.** `loadEvents` menyatukan hasil fetch dengan snapshot cache terbaru berdasarkan ID. Untuk event ID sama, nilai fetch menang karena diletakkan lebih dahulu; ini aman untuk event persisten immutable. Belum terlihat race yang pasti menghapus event baru. Perpindahan task/workspace memfilter render berdasarkan task aktif dan cache tetap dipisah per ID.

## Reproduksi dan batas bukti

- Harness real app menggunakan build Vite sementara, `src/server.ts`/Engine dengan adapter fake yang akan melempar jika dipanggil, SQLite/workspace di temporary directory, loopback proxy fault-injection, Playwright cache dan Chrome cache lokal. `/api/providers` dijawab oleh fixture; tidak ada CLI/provider invocation, credential, atau payload live.
- `docs/ux/chat-realtime/runtime-evidence.json` berisi timestamp dan event ID; screenshot: `healthy-stream.png`, `missed-text-state-only.png`, `missed-text-after-refresh.png`, `half-open-hidden-visible.png`, `reconnect-replay.png`. Script `repro.mjs` menghapus runtime temp setelah selesai.
- Hasil terukur pada satu run lokal: healthy event emit → browser receive **0 ms** (resolusi timestamp millisecond), receive → DOM mutation **16 ms**. Emit dan receive jatuh pada millisecond yang sama; ini bukan klaim latency production. Status polling terlihat setelah 5.6 detik sementara text tetap absen. Full reload menerima replay ID 3 tetapi text tetap absen karena latest non-text ID 4 lebih tinggi. Reconnect setelah response ditutup mereplay event baru dan merendernya.
- Hidden/visible pada run ini memakai dispatch `visibilitychange` sintetis karena Chrome cache menolak CDP `Emulation.setPageVisibilityState` (`browserHidden:false` di JSON). Ini menguji handler aplikasi dan stream yang tetap half-open, bukan perubahan `document.hidden` atau throttling OS background tab.
- Bukti source membuktikan stream, replay, dan retry terpasang; tes `tests/core.test.ts` sekitar 142–153 memeriksa replay awal dan lifecycle listener SSE server, bukan browser reconnect atau timing DOM.
- Tidak ada timing production/server kantor yang direkam; seluruh timing adalah loopback fixture.
- Tidak ada log task/PM atau log provider yang dibaca karena user menegaskan analisis tanpa payload privat dan tanpa invocation provider. Bukti yang ada seluruhnya dari source/config dan tes repository.

### Skenario harness terisolasi yang disarankan

Harness yang sudah ada mereproduksi healthy stream, drop satu frame text saat status berikutnya sampai, half-open + visibility transition, reload, serta reconnect setelah koneksi benar-benar ditutup. Tambahan yang masih perlu diuji: event emit saat `loadEvents` berjalan, switch task/workspace ketika event in-flight, output text >24k, replay >500 event, dan proxy Apache aktual. Catat ID/cursor dan kelengkapan transcript, bukan screenshot saja.

### Banding source checkout utama

Checkout utama yang diperiksa read-only berada di HEAD `61e27b43188b9b3b753f3fd67275d1158c9986ce`, dengan perubahan lokal pada `web/app.ts`, `web/model.ts`, `web/chat.ts`, `src/server.ts` dan file lain. Perubahan UI mencakup history/review/approval/workspace behavior; jalur cache realtime masih memiliki guard `event.id <= events[events.length-1].id` di `web/app.ts:217–227`, pemuatan 300 event non-text di `web/app.ts:331–338`, serta visibility handler yang hanya refresh state/usage di `web/app.ts:533–535`. Jadi mekanisme high-water mark yang direproduksi tampak tetap ada pada source utama yang dibaca. Source utama tidak dibangun/dijalankan; harness hanya menjalankan worktree tugas baseline `91b73e5`.

## Arah perbaikan untuk dipertimbangkan setelah reproduksi

1. Jika skenario half-open terbukti: pada `visibilitychange` saat tab terlihat, validasi stream dan bangun ulang jika perlu (AbortController/generation guard agar reader lama tidak membuat reconnect ganda). Alternatif lebih konservatif ialah polling catch-up transcript per task ketika kembali terlihat atau saat stream error; biaya request lebih tinggi, tetapi lebih sederhana dan dapat memulihkan transcript tanpa mengganti transport utama.
2. Untuk mekanisme cache yang direproduksi: ganti guard high-water tunggal dengan deteksi duplikat ID yang tepat dan sisipkan event replay pada urutan ID, agar event lama yang absen dapat diterima tanpa duplikasi. Alternatifnya, endpoint catch-up transcript harus menyertakan event text atau memberi cursor transcript yang eksplisit; jalur `tail=1` sekarang mengecualikan text.
3. Pertahankan SSE sebagai transport awal: sudah ada replay ID, heartbeat, dan jalur HTTP/proxy. WebSocket menambah protokol dan recovery sendiri tanpa bukti bahwa SSE adalah batas masalah. Pertimbangkan hanya jika kebutuhan interaksi dua arah/latensi membenarkannya.

## Acceptance checks sebelum menutup bug

- Dengan fake server, timestamp emit, receive, dan DOM menunjukkan delta terlihat tanpa reload; tool/status/result juga tiba.
- Putus setelah event ID N lalu reconnect menghasilkan seluruh event >N tepat sekali pada transcript; lebih dari 500 event replay tidak meninggalkan gap.
- Replay ID yang lebih kecil daripada non-text high-water mark tetapi tidak ada di cache tetap masuk sekali dan berada pada posisi urutan yang benar.
- Hide/show dan simulasi half-open berakhir pada stream aktif tunggal atau catch-up transcript lengkap dalam batas waktu yang ditetapkan.
- `loadEvents` yang overlap dengan SSE dan perpindahan task/workspace tidak menghilangkan, mencampur, atau menggandakan pesan.
- Tes panjang output menetapkan apakah batas 24k memang dimaksudkan atau harus ditangani oleh event message lengkap.
- Tes proxy lokal membuktikan frame serta heartbeat lewat Apache, terpisah dari pengujian server langsung.

## Kesimpulan sementara

Ada SSE live plus replay, ditambah polling state 5 detik. Harness membuktikan bahwa polling state saja tidak dapat memperbaiki transcript; reload dapat tetap kehilangan text ketika replay ID lebih rendah daripada event non-text terakhir yang sudah di-cache. Reconnect setelah stream benar-benar tutup berhasil. Ini menyediakan mekanisme konkrit yang layak diprioritaskan dalam investigasi, tetapi tidak membuktikan mekanisme tersebut menyebabkan insiden pengguna. Half-open dan tab hidden-visible juga teruji pada fixture terkontrol. Belum ada alasan mengganti SSE dengan WebSocket. Sebelum patch, validasi repro di baseline main terbaru dan rekam gejala nyata tanpa membaca payload privat.
