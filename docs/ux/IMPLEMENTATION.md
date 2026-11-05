# Implementasi lokal UX Kantor

**Selesai untuk review source dan preview PM; belum restart/deploy.** 4 November 2026. Persetujuan implementasi berasal dari penugasan PM; dokumen desain/prototype dan laporan analis tidak diubah.

## Baseline dan cakupan

CURRENT checkout `/home/ricii/gabut/orchestrator-agent` digunakan, termasuk pekerjaan paralel yang sudah unstaged. Sebelum edit, 44 berkas source/test/screenshot/README/dependency disalin ke `/tmp/office-ux-baseline/`; hash tersimpan permanen di [baseline-sha256.json](implementation/baseline-sha256.json). Baseline `npm run check` lulus dan focused tests **13/13 lulus**, tanpa existing failure pada pemeriksaan tersebut.

Berkas yang diubah oleh implementasi ini:

- `web/app.ts`: konteks, draft, keputusan, riwayat/recovery, settings, loading/error/fokus, kuota dan navigasi terminal.
- `web/style.css`: shell chat utama, token visual, responsive dan aksesibilitas. Aturan existing dipertahankan dengan override terpusat agar kontrol lama tetap tersedia.
- `web/terminal.ts`: konteks sesi, same-ID reconnect, state error/ended/missing, input serialized ke ID asal, screenReaderMode.
- `web/approval.ts`: contoh JSON dari schema yang tersedia, hanya preview; tidak mengisi/mengirim jawaban.
- `web/chat.ts`: chooser memuat provider, status, judul, waktu dan ID pembeda.
- `tests/approval.test.ts`: contoh schema, termasuk tipe yang tidak didukung tanpa field rekaan.
- `docs/screenshots/capture.mjs`, README screenshot dan PNG README; `README.md` terbatas pada label screenshot dan fakta izin. Bukti UX di dokumen ini dan `implementation/`.

Tidak ada perubahan backend/permission semantics, package/dependency, Canvas renderer, laporan analis, prototype, `.git`, data produksi atau system config. Lima belas entri baseline source backend tingkat root dan dependency diperiksa ulang: seluruh hash tetap sama. Perubahan paralel di backend, permission modes, terminal, model dan tests lain tetap dipertahankan. Tidak stage/commit/reset/stash/merge/push/publish, menjalankan launcher, atau menghentikan/restart daemon aktif.

## Perilaku akhir dan matriks acceptance

**Pass** di bawah berarti source dan/atau fixture terisolasi sesuai kolom bukti, bukan integrasi provider hidup atau sertifikasi WCAG.

| Area | Hasil | Bukti dan batas |
| --- | --- | --- |
| A1 · konteks/HEAD | Pass | Nama + path penuh, salin path dengan fallback seleksi, provider dekat composer, dua basename sama dapat dibedakan. Panduan HEAD statis di rail dan sebelum tujuan pertama; initial commit/non-Git dijelaskan. Tidak ada dirty/HEAD API baru atau klaim checkout lokal ikut worktree. Gagal menambah workspace menyimpan path dalam dialog retry. |
| A2 · izin | Pass | Manual/otomatis/full per provider, global PM+freelancer, konsekuensi pending/tool/form dan bypass terlihat. Full memakai konfirmasi native eksplisit; dismiss tidak menyimpan. Full provider running diblokir; manual↔auto tetap tersedia ketika running. Capability absen/false menonaktifkan kontrol. Server tetap final untuk running/locked/terminal. |
| A3 · keputusan | Pass | Requester/tugas/provider/workspace, command/cwd/host dan opsi exact dari `approvalChoices` existing. Pertanyaan hanya mengisi saat opsi dipilih. Tidak ada keputusan saat redraw. Form JSON invalid mempertahankan input, error, fokus/selection saat SSE; submit gagal bisa diulang eksplisit. Busy mencegah submit ganda. Card di dialog yang sudah resolved tidak lagi actionable. JSON editor fallback; schema/server tetap otoritatif. |
| A4 · chat/draft | Pass | Pada 1440 chat sekitar 808 px dan rail 344 px (~70/30). Draft memori per pasangan workspace+provider diuji dengan API settings asli. Worker hanya-baca; Kembali ke PM. Bantuan perintah, compact dan `!` tetap tersedia; `!` jelas langsung ke shell. Draft tidak dijanjikan bertahan reload. |
| A5 · hasil/riwayat/recovery | Pass + batas UI Git | Riwayat memuat semua worker nonaktif, requester membuka tugas benar; detail hasil/error, executionPath atau fallback berlabel, branch/baseCommit. Tinjau lalu lanjutkan membuka detail tanpa resume; resume hanya CTA detail. Stop PM menjelaskan anak aktif. Diff/loading/error/retry/preview dan merge explicit dipertahankan, dengan clean checkout/commit worker/merge akhir belum committed/conflict copy. Browser membuktikan review/readonly/history; semantik worktree/merge diuji suite repo, bukan merge browser ke repo aktif. |
| A6 · loading/error/SSE | Pass | Startup dan transcript loading berbeda dari empty; transcript gagal retry fetch saja. Error kirim persisten per konteks, draft tetap, tidak mengirim ulang otomatis. SSE backend demo asli mempertahankan fokus, selection dan posisi baca lama; tombol Pesan baru tersedia. Koneksi terlihat di mobile dengan peringatan status tertinggal. |
| A7 · responsive | Pass | 1440/768/390/320 tanpa overflow horizontal pada workspace/settings; kartu keputusan juga diperiksa 320. Chat dahulu, kantor terlipat ≤1199, akun/refresh mobile dapat dibuka. Composer mengikuti dokumen pada mobile, bukan fixed 620 px. OS keyboard nyata dan zoom 400% belum diuji. |
| A8 · aksesibilitas | Pass terbatas | Fokus 3 px, kontrol utama ≥44 px, label eksplisit, dialog native berjudul/fokus awal aman/Escape/fokus kembali, live status koneksi/simpan dan alert error; transcript streaming bukan live region penuh. Fokus input/button/details dipulihkan dengan key; reduced motion renderer asli dipertahankan. Delapan pasangan token memenuhi target, termasuk ink 11,57:1, muted 5,77:1, action 7,57:1, focus 7,11:1 dan control border 3,60:1. Bukan audit semua kombinasi warna atau pembaca layar end-to-end. |
| A9 · settings/jadwal | Pass | Simpan Izin, Workspace & provider, Lanjutan terpisah. GET settings terbaru lalu merge **hanya** field bagian, termasuk menjaga baseline konflik bagian lain yang belum disimpan. Sukses sesudah respons cocok dan refresh; error/konflik tidak menutup dialog atau menghapus input. Jadwal CRUD existing, model saat edit, contoh cron/timezone/daemon dan hapus bernama dipertahankan. API tidak punya CAS/version/ETag: race setelah GET tetap mungkin. |
| A10 · kuota | Pass (fixture) | Penggunaan seluruh akun, persentase terpakai, timestamp/reset zona terlihat; stale mempertahankan angka, unavailable bukan 0%. Loading dan error terlihat. Refresh mobile diuji pada 320; cooldown manual 15 detik dijelaskan, polling existing 60 detik dipertahankan. Tidak membaca akun langsung atau membuat estimasi biaya. |
| A11 · terminal | Pass (browser fixture + PTY suite) | Summary API, sesi workspace asal meski workspace utama berubah, hide ≠ stop. Poll gagal menonaktifkan input, error persisten/reconnect ID+cursor sama tanpa POST shell baru. Missing session baru dibuat setelah CTA eksplisit. Keyboard chunks tetap serialized dengan ID sesi ditangkap; `!` menunggu pengiriman, kegagalan tidak menghapus draft. xterm screenReaderMode aktif; fallback backend tanpa summary hanya sesi yang diketahui tab. Browser terminal adalah fixture HTTP, sedangkan PTY nyata sementara diuji terpisah oleh suite. Tidak ada janji buffer lintas daemon. |

## Verifikasi yang dijalankan

| Command | Hasil |
| --- | --- |
| `npm run check` | Lulus; `tsc --noEmit` backend + web noEmit. |
| `node --import tsx --test --experimental-test-isolation=none tests/approval.test.ts tests/approval-options.test.ts tests/chat.test.ts tests/office-model.test.ts tests/terminal.test.ts` | **14/14 lulus**, naik dari baseline 13 karena satu test schema ditambahkan. |
| `npm test` | **44/44 lulus**, 0 fail/skip. [TAP](implementation/tests.tap). Adapter/kuota memakai fake CLI/data sementara; tidak live provider. |
| `node node_modules/typescript/bin/tsc --outDir /tmp/office-ux-backend-build` | Lulus, output backend terisolasi. |
| `node node_modules/vite/bin/vite.js build --outDir /tmp/office-ux-frontend-build` | Lulus. Capture juga membangun source frontend terbaru ke `/tmp/kantor-docs-*/public` setiap run. Tidak menulis `public/` atau `dist/` live. |
| `PLAYWRIGHT_MODULE=/home/ricii/.cache/ms-playwright-go/1.50.1/package node --import tsx docs/screenshots/capture.mjs` | **32 pemeriksaan lulus**, 0 page error JS. [JSON](implementation/checks.json), [log](implementation/browser.txt). Chrome lokal `/usr/bin/google-chrome`, reduced motion, profil/port/database sementara. |

Capture memakai backend HTTP, Store, Engine dan SSE asli dengan adapter blocked serta dispatch/scheduler dinonaktifkan. Fault injection browser digunakan untuk network error, capability, kuota stale dan seluruh terminal browser. Settings save dan approval retry yang berhasil memakai API asli dan resolver demo; bukan provider protocol hidup. Tidak mengakses credential, login CLI atau database produksi. Browser/session/server demo dibersihkan setelah run.

Selama verifikasi, ditemukan dan diperbaiki: label select yang ambigu, header flex terjepit saat banyak keputusan, baseline konflik settings lintas bagian, fokus/selection approval saat redraw, kontras CTA reconnect terminal, dan tombol Kirim yang membungkus di tablet. Kegagalan percobaan harness (browser executable/selector, resolver approval fixture dan route terminal) diperbaiki; hasil final di atas lulus. Tidak ada existing failure yang ditemukan pada baseline scoped.

## Preview untuk PM

Seluruh gambar adalah **UI aplikasi asli dengan fixture**, tidak menyalin JS DEMO prototype. Screenshot diperiksa visual untuk hierarchy, wrap, fokus, error, controls dan overflow. README sudah memakai capture terbaru.

- Utama: [desktop 1440](implementation/workspace-1440.png), [tablet 768](implementation/workspace-768.png), [mobile 390](implementation/workspace-390.png), [reflow 320](implementation/workspace-320.png).
- Kantor dibuka: [768](implementation/office-768.png), [390](implementation/office-390.png), [320](implementation/office-320.png).
- Keputusan: [desktop](implementation/desktop-decisions.png), [command/scope](implementation/approval-command.png), [form invalid 320](implementation/form-invalid-320.png).
- Settings: [1440](implementation/settings-1440.png), [768](implementation/settings-768.png), [390](implementation/settings-390.png), [320](implementation/settings-320.png), [capability lama](implementation/settings-capability.png).
- [Review pemulihan](implementation/recovery.png), [kuota stale mobile](implementation/quota-stale-320.png), [terminal error dengan workspace asal](implementation/terminal-error-320.png).
- [Capture README kantor](../screenshots/kantor-demo.png), [settings](../screenshots/pengaturan-demo.png); [cara mengambil ulang](../screenshots/README.md).

Batas tersisa: integrasi provider/approval/kuota hidup, terminal browser ke PTY nyata, screen reader, keyboard perangkat mobile dan deployment perlu validasi terpisah. Tidak ada fitur backend spekulatif, persistensi draft reload, dirty detection, CAS settings, atau recovery terminal lintas daemon. Produksi masih menjalankan aset/proses sebelumnya sampai pemilik menjadwalkan aktivasi tersendiri.
