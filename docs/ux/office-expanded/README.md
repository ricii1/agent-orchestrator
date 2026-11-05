# Mode Kantor besar

Mode opsional memperluas canvas pixel office di desktop hingga memakai lebar konten utama. Percakapan, composer PM, approvals, workspace, dan tombol freelancer tetap tersedia; chat berada tepat setelah kantor dan state percakapan tidak di-reset saat mode diganti. Pilihan mode tersimpan di `localStorage` dengan key `office-expanded`. Tombol toolbar menampilkan **Kantor besar** atau **Kembali ke percakapan**, menyatakan state lewat `aria-pressed`, dan mempertahankan fokus saat render. Escape menutup mode saat fokus bukan di kontrol input atau dialog.

Canvas tetap dirender oleh `PixelOffice` yang sudah ada. CSS hanya mengatur ukuran layout, jadi rasio 720:420, pointer hit-testing, glyph, dan reduced motion mengikuti renderer. Daftar freelancer di bawah canvas tetap berupa tombol dengan status teks yang dapat dibaca.

## Integrasi

- [web/app.ts](/home/ricii/gabut/orchestrator-agent/web/app.ts:30): state mode lokal.
- [web/app.ts](/home/ricii/gabut/orchestrator-agent/web/app.ts:117): toolbar toggle dan `aria-pressed`.
- [web/app.ts](/home/ricii/gabut/orchestrator-agent/web/app.ts:107): class layout expanded; stage ditandai di baris 122.
- [web/app.ts](/home/ricii/gabut/orchestrator-agent/web/app.ts:528): Escape kembali ke mode percakapan dengan fokus pada toggle.
- [web/office-view.css](/home/ricii/gabut/orchestrator-agent/web/office-view.css:1): selectors baru berprefix `office-mode-`, `office-view-`, dan `office-expanded-`.

## Bukti dan verifikasi

Browser run mengompilasi UI ke direktori sementara, menyajikan bundle lokal, lalu memakai Chrome headless dengan respons API fixture. Tidak ada provider, model, daemon aplikasi, atau workspace pengguna yang dipanggil. Screenshot disimpan langsung sebagai PNG:

- [Desktop 1440 px](evidence/desktop-expanded.png)
- [Mobile 390 px](evidence/mobile-390-expanded.png)
- [Mobile 320 px](evidence/mobile-320-expanded.png)
- [Hasil checks](evidence/checks.json)
- [Harness Chrome](capture.mjs)

7 check lulus: ukuran/aspect ratio desktop chat-first, perluasan canvas, draft PM tetap ada, pemilihan freelancer dan status, approval tetap dapat diakses, draft per-workspace tetap terpisah, Escape/focus, dan fallback 390/320 px tanpa horizontal overflow. Tidak ada page error.

Perintah yang dijalankan:

```sh
npm run check
node docs/ux/office-expanded/capture.mjs
```

Screenshot dan hasil browser adalah fixture lokal, bukan capture dari live app. Perubahan ini belum diaktifkan pada live UI.

## Snapshot baseline scoped

`baseline/` menyimpan salinan awal tiga file scope (`web/app.ts`, `web/office.ts`, `web/style.css`), diff scoped pada saat mulai, dan status checkout. Snapshot menangkap perubahan unstaged yang sudah ada saat tugas dimulai; tidak mewakili HEAD bersih. Source lain tidak di-reset, di-stage, atau diubah untuk membuat snapshot ini.
