# Buka dokumen teks di aplikasi lokal

Tautan Markdown menuju dokumen teks menyediakan aksi **Buka di aplikasi lokal · …**. Aplikasi yang membuka file berjalan di laptop tempat backend Orchestrator berjalan. Aksi hanya dijalankan setelah klik pengguna; permintaan GET preview atau crawler tidak memanggil opener. Tautan gambar tetap memakai preview raster.

POST `/api/open-local` menerima `{ workspace, path }` dan melewati validasi root/artifact yang sama: workspace harus masih terdaftar, path harus berada dalam workspace atau executionPath tugas yang diizinkan, symlink tidak boleh keluar dari root, serta `.data`, `.git`, `.env`, dan nama privat ditolak. Hanya Markdown dan format teks terbatas (`txt`, `csv`, `json`, `yaml`, `toml`) yang diterima; HTML, SVG, script, executable, file biner, dan file terlalu besar ditolak. Launcher memakai argv langsung (`xdg-open`, `open`, atau `gio open`) tanpa shell.

Jika launcher tidak tersedia, UI menampilkan pesan error, memberi pilihan melihat teks, dan mengunduh salinan. GET `/api/document-text` memakai guard Host/Origin aplikasi dan validasi artifact yang sama. Uji server menginjeksi launcher fake sehingga aplikasi laptop tidak pernah dijalankan.

## Integrasi

- Baseline commit: `5caecdb49f385911ab83328977426f5e25a8ec9e`.
- Delta terbatas: `src/artifacts.ts`, `src/server.ts`, `web/format.ts`, `web/app.ts`, `tests/artifacts.test.ts`, `tests/core.test.ts`, `tests/format.test.ts`, serta `docs/ux/local-file-open/` (acceptance, screenshot, evidence, dan handoff ini).
- Delta telah diintegrasikan ke checkout utama. Aplikasi berjalan belum diaktifkan atau di-restart; tidak ada aktivasi live yang diklaim.

Direct GET `/api/previews?...README.md` juga menampilkan landing aman berisi aksi eksplisit, teks, dan unduhan; GET tidak menjalankan opener. Kegagalan proses dideteksi dari exit code nonzero dan timeout 5 detik, bukan hanya keberhasilan spawn. Link eksternal tidak diklasifikasikan sebagai dokumen lokal.

## Bukti QA

Jalankan `node --import tsx docs/ux/local-file-open/browser-acceptance.mjs`. Harness memakai Playwright cache `~/.cache/ms-playwright-go/1.50.1/package/index.mjs`, Chrome `/usr/bin/google-chrome`, DB/workspace sementara, fake adapter, dan fake opener. Tidak ada aplikasi pengguna yang diluncurkan.

- `evidence/browser-evidence.json`: hasil direct URL README, POST klik/Enter, tidak ada open saat GET, fallback dan unduhan, preview PNG, serta argv fake.
- `evidence/chat-open-flow.png` dan `evidence/document-landing-fallback.png`: screenshot browser acceptance.
- Terakhir lolos: `npm run check`; `node --import tsx --test --experimental-test-isolation=none tests/artifacts.test.ts tests/format.test.ts tests/core.test.ts`; build Vite/TypeScript ke `/tmp`.
