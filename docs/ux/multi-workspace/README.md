# Multi-workspace: implementasi dan bukti lokal

Status: source siap review di current checkout. **Belum diaktifkan pada daemon live.** Tidak ada commit/stage, deploy, restart, perubahan `.data/system`, atau panggilan provider nyata oleh pengujian fitur ini. Terminal/CSS/bridge tidak diedit oleh pekerjaan ini.

## Perilaku

- **Agent workspace** memilih PM, default freelancer, serta model Claude/Codex untuk workspace aktif. Konfigurasi disimpan di JSON settings SQLite dengan key path kanonis. Database lama tetap memakai default global tanpa migrasi destruktif.
- **+ Workspace** memakai registrasi additive yang tetap tersedia saat agent/terminal lain aktif. Misalnya A memakai Codex sementara B baru didaftarkan dan dikonfigurasi Claude.
- PM pada direktori terpisah berjalan bersamaan. Path PM yang saling mencakup dan penulis non-Git yang saling bertabrakan tetap mengantre. Freelancer Git tetap memakai worktree.
- Default freelancer diambil dari snapshot workspace induk saat PM dibuat. Parent lama yang belum memiliki snapshot memakai konfigurasi workspace parent. Pilihan workspace di UI maupun target folder child tidak mengalihkan default. Override provider/model eksplisit tetap berlaku.
- Mengubah konfigurasi workspace memerlukan agent, anak aktif/queued/waiting, dan merge lock terkait selesai. Agent di workspace lain boleh terus bekerja. Terminal tidak memblokir konfigurasi agent yang tidak mengubah akses filesystem.
- Provider/model/default baru dapat membuka sesi PM tersendiri. Sesi lama tetap ada di selector chat dan Riwayat; model/provider tugas lama tidak ditulis ulang. Mengembalikan konfigurasi yang sama dapat memakai sesi sebelumnya. Sesi yang dihentikan perlu dilanjutkan secara eksplisit.
- Draft dan konteks composer mengikuti workspace dan konfigurasi agent. Pengiriman dengan konfigurasi UI yang sudah berubah ditolak agar tidak salah sesi. Scoped config memakai compare-and-set; perubahan dari tab lain menghasilkan HTTP 409.
- `maxWorkers` tetap batas global (default 3; rentang 1–10), terlihat di dialog workspace. Izin manual/auto/full tetap global per provider. Guard penghapusan root, default global, batas worker, dan transisi full tetap berlaku; queued tasks ikut dilindungi.
- Jadwal tetap menyimpan provider/model eksplisit. Model jadwal kosong mempertahankan fallback model global sebelumnya; perubahan workspace tidak mengubah jadwal tersimpan.

## API

| Endpoint | Scope |
| --- | --- |
| `POST /api/workspaces` `{workspace}` | Menambah direktori absolut yang ada, canonical realpath, idempotent, maksimum 30 roots; tidak menerima izin/removal/settings lain. |
| `PUT /api/workspaces/agents` `{workspace, agents, expected}` | Workspace yang diizinkan saja; empat field provider/model, validasi tipe/panjang/karakter model, expected config wajib cocok. |
| `POST /api/pm/messages` | Tambahan opsional `expectedAgents` untuk mencegah composer stale berpindah sesi. |
| `PUT /api/settings` | Scope global lama, mempertahankan konfigurasi workspace; UI mengirim `expectedSettings` untuk mendeteksi race. |

## Validasi

- `npm run check`: lulus TypeScript backend dan frontend.
- `npm test`: **60/60 lulus**, tanpa skipped/cancelled (44 tes yang sudah ada + 16 tes multi-workspace baru). Lihat [hasil lengkap](tests.tap).
- **16 tes terfokus** di [tests/multi-workspace.test.ts](../../../tests/multi-workspace.test.ts) meliputi fallback legacy/reopen SQLite, snapshot parent, override task/jadwal, concurrent PM/admission, alias path, global worker limit, scoped capabilities/approvals, SSE/history, worktree isolation, guard busy/full/removal, CAS, serta foreign non-Git write locks.
- Build backend dan Vite lulus dengan output terisolasi di `/tmp/multi-workspace-build.6DAH2q/{dist,public}`. `public/` dan `dist/` live tidak dibangun ulang. Lihat [build log](build.log).
- Chromium menjalankan aplikasi asli dengan adapter palsu, DB/repo/folder sementara, quota stub tanpa pembacaan kredensial, serta port loopback ephemeral: **16/16 pemeriksaan browser**, tanpa runtime error. Lihat [hasil](browser-checks.json) dan [script reproducible](preview.ts).

Preview: [pengaturan desktop](workspace-settings-1440.png), [B Claude berjalan bersamaan dengan A](parallel-B-1440.png), [sesi PM lama](old-PM-history-1440.png), [pengaturan mobile 390px, tombol simpan terjangkau](workspace-settings-390.png). Seluruh data preview berlabel DEMO; gambar tidak membuktikan eksekusi CLI/provider nyata.

Reproduksi build/preview tanpa menyentuh output live:

```sh
multi_build_dir=$(mktemp -d /tmp/multi-workspace-build.XXXXXX)
./node_modules/.bin/tsc --outDir "$multi_build_dir/dist"
./node_modules/.bin/vite build --outDir "$multi_build_dir/public"
node --import tsx docs/ux/multi-workspace/preview.ts "$multi_build_dir/public"
```

Script memakai Chromium/Playwright yang sudah tersedia pada mesin ini; override lokasi memakai `MULTI_WORKSPACE_CHROMIUM` / `MULTI_WORKSPACE_PLAYWRIGHT`. Tidak menambah dependency.

## Scope review dan batas

Source yang diubah: `src/types.ts`, `src/engine.ts`, `src/server.ts`, `web/model.ts`, `web/app.ts`; tambahan `tests/multi-workspace.test.ts`, dokumentasi ini, dan area workspace/provider pada README utama. Store JSON yang ada sudah mendukung persistence field tambahan, sehingga schema SQL tidak perlu diubah. `src/workspace.ts`, MCP/tool bridge, adapter, terminal, default shell dan CSS tetap memakai implementasi yang ada.

Baseline scoped disimpan sebelum edit di `/tmp/multi-workspace-baseline/` (`before.patch` dan salinan file source). [Delta source pekerjaan ini](scoped-source.patch) membandingkan dengan baseline tersebut, untuk memisahkan perubahan ini dari perubahan unstaged yang sudah ada. [Catatan tahapan](progress.md) mencatat hasil sementara dan final.

Batas: belum menguji subscription/CLI asli; konfigurasi baru tersedia setelah pemilik memperbarui instance live ketika aman. PM/worker yang menulis direktori bertabrakan tetap harus menunggu, dan batas freelancer tidak terpisah per workspace. Worktree berawal dari HEAD repository; perubahan uncommitted checkout tidak disalin. Tes CLI suite yang sudah ada memakai fake CLI; preview tidak membuka shell terminal.
