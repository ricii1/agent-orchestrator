# Retest terminal via Playwright + PTY

Dijalankan 5 Nov 2026 dari checkout saat ini. Browser UI memakai komponen `TerminalPanel` produksi dan xterm yang sama. Backend fixture memulai `/bin/zsh -i` lewat `scripts/terminal-bridge.py`, dengan HOME/ZDOTDIR sementara, PATH minimal, history sintetis `echo suggestion-demo`, dan plugin zsh autosuggestions + syntax-highlighting terpasang. Tidak membaca konfigurasi, history, isi terminal, atau workspace pengguna; tidak tersambung ke backend kantor live. PTY dan folder sementara dibersihkan ketika script selesai.

## Hasil interaksi

- Playwright mengetik `echo` per karakter melalui keyboard. PTY mengembalikan ghost suggestion `suggestion-demo` dengan SGR `90`; xterm merendernya sebagai `rgb(138, 148, 141)` pada background `rgb(22, 29, 25)`. Input aktual `echo` tampil lebih terang. Jadi output ANSI tidak dibuang dan saran tampak jelas pada screenshot.
- Enter mengirim `\r`, menjalankan hanya `echo`, lalu kembali ke prompt. `suggestion-demo` tidak diterima otomatis.
- ArrowRight dikirim xterm dalam application cursor mode sebagai `ESC O C`. Pada fixture zsh bersih, keymap yang aktif tidak menerima ghost suggestion dari sequence tersebut. Ini perilaku key binding shell/terminal mode, bukan hilangnya ANSI atau kegagalan render; hasilnya belum membuktikan binding pada konfigurasi shell pengguna. Backspace (`DEL`), Tab (`\t`), Ctrl+C, dan pengetikan multi-token juga dikirim ke PTY.
- Perintah `if true; then` tampak dengan syntax highlighting shell; sesi fixture kemudian dibatalkan.
- Ukuran terminal berubah dari 148×23 desktop ke 43×33 pada viewport 390×844. Tidak ada error JavaScript/API fixture.

## Versi live

`GET http://kantor.test/` saat pemeriksaan mengarah ke `/assets/terminal-Cx4qRVBm.js`. SHA-256 asset yang diambil dari live sama persis dengan output bundel terminal dari build source terisolasi: `7b746b3541a46624c9c7585503e50b88aa6769736414b0b4299e8162a62da858`. Asset live memuat palet terminal baru. Jadi mismatch source-versus-live untuk bundle terminal tidak ditemukan. Jika tab lama masih terbuka dari sebelum aset itu disajikan, reload tab akan memuat bundle live saat ini; restart daemon tidak diperlukan untuk bundle ini. Uji ini tidak reload tab kantor, membuka terminal kantor, atau mengirim input ke sesi live.

## Reproduksi

```sh
node docs/ux/terminal-retest/qa-shell.mjs
npm run check
TASK_BUILD_DIR=$(mktemp -d /tmp/terminal-retest-build.XXXXXX)
tsc --outDir "$TASK_BUILD_DIR/server"
./node_modules/.bin/vite build --outDir "$TASK_BUILD_DIR/web"
```

Build ditulis di `/tmp`, bukan `public`/`dist` live. Playwright dan Chromium memakai cache lokal yang sudah ada; dependencies/package tidak diubah. `fixture.html` memuat CSS dan komponen terminal aktual dari source. `evidence.json` berisi input keyboard, baris buffer xterm, warna computed DOM, sequence ANSI dari output PTY, dan ukuran grid. PNG adalah screenshot asli browser.

## Screenshot

- [Sebelum mengetik](before-desktop.png)
- [Sesudah mengetik prefix dan melihat suggestion](suggestion-desktop.png)
- [Sesudah Enter](enter-desktop.png)
- [ArrowRight](arrowright-desktop.png)
- [Backspace](backspace-desktop.png)
- [Tab](tab-desktop.png)
- [Syntax highlighting](syntax-desktop.png)
- [Viewport mobile 390×844](mobile-390.png)

Batas: hasil mewakili xterm UI dan PTY zsh fixture ini. Ia tidak menguji shell/config plugin pengguna, profile terminal lain, IME, atau tab live yang sedang terbuka. `web/terminal.ts` dan CSS terminal tidak diubah dalam retest ini karena bundle live sudah memuat renderer yang dimaksud dan repro menunjukkan ANSI suggestion dirender.
