# Notifikasi task

Modul `web/notifications.ts` opt-in (default mati). Preferensi disimpan di localStorage browser dan disinkronkan ke konfigurasi global daemon di memori; artinya semua tab/browser yang memakai daemon itu berbagi on/off dan jenis notifikasi, sementara browser lain tidak. Reload memulihkan pilihan dari localStorage dan menyinkronkannya tanpa menunggu pengguna membuka settings.

Daemon berlangganan langsung ke event `approval` dan status `completed`, jadi notifikasi desktop tidak menunggu tab aktif/polling. `notify-send` dijalankan melalui `execFile` argv tanpa shell; capability hanya dianggap tersedia jika command dan session desktop (`DISPLAY`/`WAYLAND_DISPLAY` serta `DBUS_SESSION_BUS_ADDRESS`) ada. Opt-in mati secara default. Tombol uji mengirim payload statis lewat jalur desktop yang sama saat tersedia; jika tidak, mencoba browser fallback atau menunjukkan toast. Saat tidak tersedia atau sender gagal, settings menampilkan alasan. Native notify-send tidak memberi aksi klik yang bisa diandalkan; browser fallback punya aksi klik.

Snapshot pertama browser menjadi baseline sehingga histori completed tidak membanjiri pengguna. Browser transition mengandalkan status event version dari `/api/state`, sehingga completed cepat dan retry completed tetap dibedakan walau `updatedAt` sama. Dedupe desktop native dilakukan oleh satu subscriber per daemon; browser toast/Notification memakai claim API atomik lintas tab, Web Locks, lalu transaksi IndexedDB sebagai fallback offline. Cache dibatasi (500 key server, 200 key IndexedDB). SSE/poll replay tidak memanggil sender.

Notifikasi berisi workspace dan nama/role agent, bukan prompt, approval detail, atau hasil. Klik mengarahkan ke dialog task yang memuat approval terkait; tidak ada aksi approve/resume otomatis. Jika approval sudah resolved, dialog menampilkan state saat ini.

Browser Notification hanya diminta eksplisit melalui tombol izin dan hanya digunakan pada secure context dengan permission granted. Pada origin `http://kantor.test` live yang diperiksa read-only, halaman terlayani HTTP biasa; custom hostname HTTP bukan secure context. Jalur daemon native adalah kandidat desktop lokal untuk origin itu, tetapi capability nyata bergantung pada environment daemon. Source telah terintegrasi, tetapi belum diaktifkan pada server live; desktop notification di live belum tersedia atau dijanjikan.

## Integrasi dan verifikasi

Delta notifikasi telah diintegrasikan ke checkout utama. `server()` menerima `{ openLocal, nativeSender }` sebagai opsi bernama agar launcher lokal dan sender notifikasi tidak tertukar. State mengirim `statusVersions` bersamaan dengan `reviewDismissals`; listener event dilepas ketika server tutup. UI, endpoint dan fake sender mempertahankan perlindungan host/origin yang sama.

Harness pada checkout utama: `NOTIFICATION_BUILD=/tmp/followup-merged-build/web node --import tsx docs/ux/notifications/browser-acceptance.mjs`. Harness menggunakan temp DB/workspace, fake adapter/sender dan mock Notification. Hasil gabungan 14 assertion ada di [follow-up integration evidence](../followup-integration/evidence/notifications/evidence.json); screenshot settings juga disimpan di sana. QA tidak memanggil notify-send.

Source telah terintegrasi tetapi versi live belum diaktifkan, di-build ke output produksi, atau di-restart.
