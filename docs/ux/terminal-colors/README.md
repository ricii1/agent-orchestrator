# Bukti perbaikan warna terminal lokal

Diuji pada checkout saat ini, 5 November 2026. **Patch lokal, belum diaktifkan pada UI live.** Tidak menjalankan provider/model, daemon aplikasi, `npm run office`, atau build ke `public`/`dist` live. Tidak mengubah dotfiles, dependencies, backend, izin, data produksi, atau source lain. Tidak stage/commit/push.

## Akar masalah yang terbukti

- `web/terminal.ts` hanya menentukan background `#20251f` dan foreground `#e0e6d9`. xterm **5.5.0** mengisi ANSI16 dari palet default. ANSI8/brightBlack default `#555753` memiliki kontras sekitar **2,14:1** terhadap background tersebut: saran sudah berbeda, tetapi terlalu sulit dibaca. Ini masalah keterbacaan yang direproduksi, bukan bukti bahwa renderer sebelumnya menghapus ANSI.
- Cascade CSS panel: deklarasi awal `#20251f/#e0e6d9` ditimpa bagian redesign menjadi `#202f28/#e4efdc`, sedangkan viewport xterm tetap memakai theme lama. Screenshot/computed styles mengonfirmasi latar berbeda.
- Pemeriksaan `.zshrc` dibatasi pada nama plugin/theme dan assignment style highlighting: `robbyrussell`, `zsh-autosuggestions`, `zsh-syntax-highlighting`; tidak ditemukan assignment langsung `ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE`. Plugin autosuggestion terpasang v0.7.1 memiliki default `fg=8`. Shell terisolasi yang memuat dua plugin tersebut benar-benar mengeluarkan SGR `90` untuk saran. Ini tidak membuktikan seluruh style/hook pada shell live pengguna.
- Bridge menetapkan `TERM=xterm-256color`. xterm menerima bytes base64 langsung; tidak ditemukan filter ANSI pada renderer. `minimumContrastRatio` default xterm adalah **1**, bukan penyebab penyamaan warna. Sumber terpasang diperiksa melalui `node_modules/@xterm/*/lib/*.js.map` dan typings, tanpa mengandalkan dokumentasi versi lain.

## Perubahan

Hanya source `web/terminal.ts` dan dua deklarasi scoped `.terminal-panel` dalam `web/style.css`:

- Palet ANSI16, cursor/accent, selection aktif/nonaktif eksplisit. Background `#161d19`, foreground `#e4efdc`, ANSI8 `#8a948d`.
- Kontras ANSI8 sekarang sekitar **5,48:1**, sementara input default **14,44:1**. Saran tetap lebih redup. Warna prompt/highlighting mengikuti ANSI dari shell; tidak ada klasifikasi command/saran, regex output, atau auto accept tambahan.
- `minimumContrastRatio:1` eksplisit agar peningkatan kontras tidak menyamakan ghost text dengan input. SGR dim tetap diproses xterm (alpha 0,5).
- CSS panel mengambil background/foreground dari custom properties yang diisi theme renderer; override warna redesign yang bertentangan dihapus. Layout redesign lainnya dipertahankan.
- Petunjuk singkat menjelaskan saran **dari plugin** biasanya redup dan belum menjadi input; tidak mengklaim semua zsh memiliki autosuggestion.
- ANSI256 16–255 dan truecolor tidak diubah. `fg=240` tetap `#585858` (kontras sekitar 2,41:1 di background baru). Jika shell eksplisit memilih warna sangat redup, renderer menghormatinya.

Snapshot source sebelum patch: [terminal](baseline-terminal.ts.txt), [CSS](baseline-style.css.txt). [Diff dari baseline](renderer.patch) memisahkan pekerjaan ini dari source unstaged yang sudah ada.

## Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run check` | Lulus: server `tsc --noEmit` dan web `tsc -p web/tsconfig.json` |
| `tsc --outDir "$TASK_BUILD_DIR/server"` + `vite build --outDir "$TASK_BUILD_DIR/web"` | Lulus; direktori hasil `mktemp` di `/tmp`; [log](build.log) |
| Browser Chromium + TerminalPanel produksi / xterm nyata | Lulus; ANSI16, ANSI8, ANSI240, truecolor, dim, resize API, input `x`/Backspace; [hasil](after-results.json) |
| PTY `zsh -d -f -i` + dua plugin asli terpasang | Lulus; default ANSI8, override fixture ANSI240, Enter tidak menerima ghost argument; [hasil](zsh-checks.json) |
| Replay bytes PTY asli ke renderer browser | Lulus; keyboard `echo`/Enter diteruskan apa adanya; [hasil](zsh-results.json), [log browser](browser-check.log) |

Desktop 1440×1000 menghasilkan grid 148×23; mobile 390×844 43×33; mobile 320×640 34×22. Grid berada di dalam host dan ukuran yang dikirim ke API sesuai. Screenshot diperiksa untuk ascender/descender, underscore, simbol, aksen, CJK, wrap, serta cursor. CSS global `body{line-height:1.6}` tidak mengalahkan aturan xterm; tidak ada override warna span `.xterm` dari app. Font terminal memakai `monospace` lokal, tanpa `@font-face` atau webfont async. Pengujian menunggu `document.fonts.ready`, melakukan resize viewport, dan memeriksa FitAddon/ResizeObserver yang sudah ada. **Tidak ditemukan clipping atau kegagalan pengukuran font yang membenarkan patch sizing/font.**

Screenshot:

| Skenario | Desktop | Mobile 390 | Mobile 320 |
| --- | --- | --- | --- |
| Sebelum | [1440](before-1440.png) | [390](before-390.png) | [320](before-320.png) |
| Sesudah: ANSI, input terang, ghost redup, glyph | [1440](after-1440.png) | [390](after-390.png) | [320](after-320.png) |
| Plugin zsh asli, replay PTY | [1440](zsh-1440.png) | [390](zsh-390.png) | [320](zsh-320.png) |

[Selection aktif](after-selection.png). Screenshot sebelum memakai fixture inti yang sama; sesudah ditambah baris truecolor/palet16 untuk pemeriksaan lebih lengkap.

## Reproduksi dan batas

Dari root checkout:

```sh
python3 docs/ux/terminal-colors/capture-zsh.py
node docs/ux/terminal-colors/verify-renderer.mjs after
node docs/ux/terminal-colors/verify-renderer.mjs zsh --real
```

Script memakai plugin lokal yang telah diperiksa, HOME/ZDOTDIR sementara, environment minimal, `HISTFILE=/dev/null`, history sintetis `echo suggestion-demo`, dan prompt statis. Tidak memuat `.zshrc`, `.zshenv` pengguna, oh-my-zsh/theme, atau hook pengguna. Hanya shell fixture milik proses pengujian yang ditutup. Jika plugin tidak tersedia, script gagal eksplisit. Lokasi Playwright/Chromium cache dapat diatur lewat `TERMINAL_PLAYWRIGHT_MODULE` dan `TERMINAL_CHROMIUM`, tanpa mengubah package/dependencies.

Server Vite fixture hanya bind `127.0.0.1` pada port sementara dan ditutup setelah tes. Renderer adalah `TerminalPanel` asli dengan xterm 5.5, **API fixture**, bukan backend/terminal live. Mode `--real` mereplay bytes dari PTY asli; bukan koneksi browser ke shell live. Uji penerimaan Enter pada zsh dilakukan terpisah dalam PTY. Screenshot memakai shell/prompt/history sintetis, bukan isi privat pengguna. Tidak mencakup semua terminal emulation, browser, font OS, IME, tema zsh, atau device fisik.

Renderer tidak dapat mengetahui mana command dan mana saran tanpa ANSI/style yang dikirim shell; output program yang redup juga dapat memakai warna sama. Perubahan ini meningkatkan palet, bukan menebak makna teks.

## Mengaktifkan setelah idle

Saat pekerjaan agent dan terminal aktif sudah idle, lakukan alur build/release lokal yang biasa dan telah disetujui untuk menyajikan frontend terbaru; kemudian muat ulang tab dan buka panel terminal. Build verifikasi di `/tmp` tidak mengganti aset yang sedang disajikan. Jangan reload tab yang masih memiliki input belum dikirim. Tidak perlu mengubah `.zshrc` atau memaksa tema shell. Aktivasi/restart/deploy **tidak dilakukan** dalam tugas ini.
