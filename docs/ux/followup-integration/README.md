# Integrasi lima delta final

Integrasi lokal ini menargetkan checkout utama pada baseline `5caecdb49f385911ab83328977426f5e25a8ec9e`. Lima delta yang digabung:

- **Terminal Sol:** hapus `NO_COLOR` warisan dari child PTY dan set `COLORTERM`; perubahan scoped pada bridge, tes terminal, dan bukti.
- **Dismissal review:** metadata terpisah per task/status/`updatedAt`, versi monotonik, compare-and-set atomik dengan HTTP 409, UI ignore/restore, dan stale conflict yang tetap terlihat.
- **Dokumen lokal:** safe landing pada GET, opener hanya pada POST setelah aksi pengguna, fallback baca/unduh teks, validasi root aktif, symlink dan private path, serta external link tidak dicegat.
- **Realtime scroll:** restore scroll sinkron, force-follow untuk own-send, catch-up ulang saat ada request bersamaan, skip duplikat transcript, dan unread overlay.
- **Notifikasi:** daemon `notify-send` via argv, opt-in mati secara default, status versi event, endpoint/claim, deduplikasi tab, fallback dan error UI, serta klik membuka konteks task terbaru.

## Kontrak integrasi

`server()` menerima opsi bernama `{ openLocal, nativeSender }` setelah parameter `usage`. Semua harness dan test yang menginjeksi fake launcher atau sender menggunakan properti yang sesuai. Default produksi memakai opener dan native sender sebenarnya. `/api/state` memuat **keduanya** `reviewDismissals` dan `statusVersions`; listener event notifikasi dilepas saat server tutup. Realtime dari HEAD, office expanded, tema ANSI, Agent workspace/multiworkspace, dan optimistic guard review tetap ada.

## Verifikasi pada checkout utama

Full suite dijalankan sekali pada source gabungan: **79/79 lulus, 0 gagal**. Ringkasan perintah dan statusnya dicatat di [verification record](evidence/verification-record.md). Raw stdout `npm test` tidak tersimpan sebagai file saat run; catatan itu menyatakan batas tersebut secara eksplisit.

- `npm run check` — lulus.
- `npm test` — 79/79 lulus.
- `npx tsc --outDir /tmp/followup-merged-build/server` — lulus.
- `npx vite build --outDir /tmp/followup-merged-build/web` — lulus.
- `git diff --check` — lulus.
- Browser review: [evidence](evidence/review-dismiss/evidence.json) — stale 409, count, ignore/restore, reload, focus, dan mobile.
- Browser local-file: [evidence](evidence/local-file-open/browser-evidence.json) — 5 assertion, termasuk GET tanpa opener, click/Enter, fallback teks/unduh, dan image preview.
- Browser realtime: [evidence](evidence/realtime-tab-scroll/runtime-evidence.json) — 15 assertion dan geometry trace; metadata baseline `5caecdb49f385911ab83328977426f5e25a8ec9e`.
- Browser notifications: [evidence](evidence/notifications/evidence.json) — 14 assertion dengan fake sender.
- Terminal Sol PTY: [after evidence](evidence/terminal-sol/after-evidence.json) dan screenshot tiga viewport; before/after QA berjalan pada PTY terisolasi.
- Office expanded: [checks](evidence/office-expanded/checks.json) — 7 checks lulus, tanpa page error.

Verifikasi terfokus artifact/format/core dan terminal termasuk dalam full suite. Build browser disimpan ke `/tmp`; tidak ada provider, credential, workspace pengguna, opener OS, atau `notify-send` yang digunakan. Output bukti worker sebelumnya dipulihkan setelah run; hasil merged disimpan di folder `evidence/` ini.

## Backup dan rollback terbatas

Sebelum edit, HEAD, status, dan SHA-256 dicatat di `/tmp/followup-main-20261105T070300Z/head.before`, `status.before`, dan `sha256.before` (217 path). Backup file tracked target ada di `/tmp/followup-main-20261105T070300Z/tracked-targets.tar`.

Untuk rollback, periksa `git status` dan diff terkini, lalu pulihkan **hanya path source yang dipilih** dari tar setelah memastikan tidak ada edit baru yang perlu dipertahankan. Jangan mengekstrak seluruh tar secara membabi buta, jangan menghapus file, dan jangan memulihkan atau menimpa `.data`, worktree worker, atau data runtime. Backup tersebut tidak mencakup untracked artifacts integrasi; hapus tidak diperlukan untuk rollback source.

## Status index dan aktivasi

Saat menerapkan hunk, `git apply --3way` sempat menulis stage entries ke index. Setelah menyelesaikan konflik, index dibersihkan dengan `git reset --mixed HEAD`; pemeriksaan akhir `git diff --cached --quiet` berhasil (index kosong). Tidak ada commit. Status source tetap perubahan lokal yang belum di-commit.

Belum ada aktivasi aplikasi berjalan, build ke output produksi, deploy, atau restart. Realtime harness hanya menguji event visibility sintetis; Chromium tidak mengubah `document.visibilityState` saat halaman lain dibuka, jadi perilaku tab OS/native tidak terbukti. Notifikasi native bergantung pada sesi desktop daemon (`DISPLAY`/`WAYLAND_DISPLAY`, DBus, dan `notify-send`); browser harness hanya memakai sender/Notification mock. Notifikasi tetap mati sampai diaktifkan, dan klik native tidak dijanjikan. PTY yang sudah hidup mempertahankan environment lamanya; verifikasi setelah aktivasi memerlukan PTY baru.
