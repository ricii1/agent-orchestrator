# Screenshot aplikasi

Kedua PNG README berasal dari frontend aplikasi yang dibangun terisolasi dan backend HTTP asli dengan SQLite sementara. Dua workspace demo memakai basename yang sama di `/tmp/kantor-docs-*/demo-{a,b}/proyek-dokumentasi`, percakapan dan worker menunggu adalah fixture. Model tidak dijalankan; kuota akun tidak dibaca.

- [kantor-demo.png](kantor-demo.png): chat PM utama, konteks path/provider dan rail Canvas kantor asli.
- [pengaturan-demo.png](pengaturan-demo.png): izin global manual/otomatis/akses penuh dan bagian settings yang disimpan terpisah. Dialog dapat digulir untuk Workspace & provider serta Lanjutan.

Capture 4 November 2026, Chrome lokal headless, viewport README 1440×960, skala 1, reduced motion. Port loopback dipilih OS; browser memakai profil baru dan hanya mengakses origin demo. Kedua gambar README diambil sebelum fault injection browser, tanpa mock respons HTTP atau modifikasi DOM untuk menggambar tampilan. Database, shell dan percakapan instance aktif tidak diakses.

## Mengambil ulang dan memverifikasi

Dari root proyek, dengan Playwright yang sudah tersedia di lingkungan (tanpa menambah dependency):

```sh
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  CHROME_BIN=/usr/bin/google-chrome \
  node --import tsx docs/screenshots/capture.mjs
```

Default module `playwright`; default executable `/usr/bin/google-chrome`. Script membangun frontend ke direktori sementara, menjalankan source backend melalui `tsx`, mengisi database demo, dan menimpa dua PNG README serta artefak [implementasi UX](../ux/implementation/). Aset build, database, profil browser dan HTTP server demo dibersihkan pada akhir proses; `public/` dan `dist/` checkout tidak ditulis.

Adapter menolak eksekusi, dispatch engine dan scheduler demo dinonaktifkan, pembaca kuota diganti fixture unavailable, dan executable pengecekan login diarahkan ke `/usr/bin/false` hanya di proses capture. Folder workspace demo benar-benar dibuat di direktori sementara agar simpan settings dapat diuji melalui API asli; script tidak menelusuri filesystem produksi.

Pemeriksaan lanjutan memakai UI asli dengan data fixture dan SSE backend asli. Fault injection browser **terisolasi** dipakai untuk error submit/transcript/settings, capability backend lama, quota stale, dan terminal (termasuk summary sesi). Terminal browser tidak membuka shell nyata. State full/running, konflik settings dan approval resolver dibuat khusus di harness demo. Semua ini tercatat dalam [checks.json](../ux/implementation/checks.json), dengan penjelasan dan acceptance matrix di [IMPLEMENTATION.md](../ux/IMPLEMENTATION.md).

Bukti ini tidak memvalidasi login/provider hidup, delegasi model nyata, persetujuan provider langsung, kuota akun langsung, restart daemon, OS keyboard mobile, pembaca layar end-to-end atau autostart. Unit/integration suite repo memakai fake CLI dan PTY sementara secara terpisah. Tidak ada deploy/restart produksi.
