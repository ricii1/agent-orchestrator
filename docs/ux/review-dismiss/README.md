# Abaikan dari Perlu ditinjau

Tugas child berstatus gagal atau terputus dapat dikeluarkan dari perhatian memakai **Abaikan** pada daftar dashboard, daftar review, atau detail. Metadata tersimpan terpisah dari task di tabel SQLite `review_dismissals`; hasil, status, dan event task tetap utuh. Tab **Diabaikan** di Riwayat menampilkan item tersebut, dengan **Tinjau lagi** untuk memulihkannya.

Dismissal berlaku pada versi kegagalan yang tersimpan sebagai task ID, status, dan `updatedAt`. Penyimpanan task memastikan `updatedAt` monotonik ketika beberapa transisi terjadi pada milidetik yang sama, sehingga kegagalan baru setelah retry muncul lagi. Approval tetap mengikuti alur persetujuannya sendiri.

Aksi ignore/restore mengirim pasangan `status + updatedAt` dari task yang sedang ditampilkan. Backend membandingkannya secara atomik dengan task terbaru sebelum menulis metadata dan membalas HTTP 409 bila versi berbeda. UI memuat state terbaru lalu menampilkan konflik; aksi dari detail lama juga membuka ulang detail versi terbaru.

## Verifikasi

- `npm run check`
- QA worker scoped sebelumnya: 70 tes. Pada checkout utama setelah kelima delta digabung, `npm test` lulus 79/79; termasuk API/temp DB multi-workspace, persistence/reopen, status/riwayat, serta versi retry.
- `npx vite build --outDir /tmp/review-dismiss-dist --emptyOutDir`
- `node docs/ux/review-dismiss/repro.mjs` — Google Chrome headless dengan fake API yang menolak versi stale, menguji konflik 409 yang terlihat, fokus setelah refresh/reflow, ignore, reload, restore, count, dan lebar 320 px. Detail ada di [evidence.json](./evidence.json); tangkapan layar di [review-320.png](./review-320.png).

Semua browser fixture memakai task sintetis. Build berada di `/tmp`; tidak ada daemon, CLI provider, atau data produksi yang digunakan.

## Baseline integrator

Worktree berasal dari `5caecdb49f385911ab83328977426f5e25a8ec9e`. SHA-256 konten file **di baseline**:

| File | SHA-256 baseline |
| --- | --- |
| `src/server.ts` | `5be1eadd14af6d287115709c8b5437ecb08d088569aaf29ac36f6ddb9ae08faf` |
| `src/store.ts` | `13962e1030bcf1675b3fa445f05458eb238395d2f3443c68006a4ff1e1d404fa` |
| `src/types.ts` | `b052fcd3793aa5c31ba5cdf1cd7eca753bf883db2ee7291cab7df733f03c4b66` |
| `web/model.ts` | `4ba4dafea2540075d9c93791531dee0e4e859cbc620dad4deca8ab12467fe257` |
| `web/app.ts` | `cf478bd9fb7ba382fbbbff7cf5f41fe54cf703bfbdb9cf5f261614bfb44d3dac` |
| `web/review.css` | `866d7f01480782a97980e04b674d3f3c7cf33b7d8a65f53389c6b75856c3e0fa` |
| `tests/review-model.test.ts` | `1e973d060e7e754b0efe2c4353b6f25062caea3e9243813545114639854c8f97` |
| `tests/multi-workspace.test.ts` | `0708d6a372037e03a30cad7ccc9b164672027b6756d8ffd4d0931acb89ce357c` |

The review delta is integrated into the main checkout and remains inactive in the running app until its updated source is loaded. No task execution, result, or approval data is changed by ignore/restore.
