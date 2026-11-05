# Baseline terisolasi untuk worker paralel

Snapshot ini dibuat dari current checkout pada 5 Nov 2026 agar worker dapat membuat worktree dari source terbaru, bukan dari HEAD checkout peluncuran yang lebih lama.

- Path baseline: `/home/ricii/gabut/orchestrator-agent/.data/dev-baselines/ux-followups-20261105-sNfpVV`
- Snapshot commit (repo baseline saja): `91b73e5a0f10b8855d6d48ba6ecaa0260250c7af`
- Snapshot tree hash: `263fd7b1f4b9f85d93b20d8de42665fd7903086c`
- HEAD checkout asal: `61e27b43188b9b3b753f3fd67275d1158c9986ce`
- Isi commit: 167 file source/dokumentasi yang relevan, ditambah dua symlink dependency.
- Dependency: `node_modules` dan `vendor` adalah symlink absolut ke dependency checkout asal untuk QA; perlakukan read-only.
- Status repo baseline setelah snapshot: bersih.

## Disalin

Source dan dokumentasi checkout, termasuk semua perubahan tracked, unstaged, dan untracked relevan saat snapshot dibuat: `src/`, `web/`, `tests/`, `scripts/`, `docs/`, file konfigurasi root, serta `vendor` sebagai symlink dependency. Commit snapshot dibuat memakai identitas Git lokal yang sudah tersedia, hanya di repo baseline.

## Dikecualikan

- `.git` checkout asal, seluruh `.data/` (database/runtime/task state), `.env*`, direktori `secrets/`, file `*.pem` dan `*.key`.
- `node_modules` dan isi `vendor` (dependensi), `apps/` (subproject lokal besar yang di-ignore, berisi `.env` dan fixture key/cert), `dist/`, `public/`, `coverage/`, dan `.cache/`.
- Database SQLite, PID/socket, serta artefak instalasi/service lokal di `deploy/` dan `docs/LOCAL-SERVICE.md`.

Tidak ada scheduler lock, daemon, data produksi, atau checkout utama yang diubah oleh pembuatan snapshot. Worker dapat diarahkan membuat worktree dari path repo baseline di atas. Jangan memakai checkout peluncuran `.git` sebagai workspace paralel bersama.
