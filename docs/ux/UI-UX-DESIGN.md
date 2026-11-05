# Desain UI/UX Kantor

**Status: siap review PM; belum persetujuan implementasi.** 4 November 2026, Asia/Jakarta. Urutan handoff: Product Analyst → PM → Designer (dokumen ini) → review preview oleh PM → Frontend Developer. Draft awal disimpan sebelum prototype disempurnakan.

## 1. Acuan dan keputusan

Desain memakai **CURRENT checkout** `/home/ricii/gabut/orchestrator-agent`, termasuk source yang belum committed, bukan worktree HEAD lama. Dibaca: [PRODUCT-ANALYSIS.md](PRODUCT-ANALYSIS.md), [README](../../README.md), [ROADMAP](../ROADMAP.md), seluruh modul `web/`, tipe task/settings, opsi approval dan rute API terkait. Tidak ditemukan AGENTS.md pada jalur induk checkout maupun docs/web. Kedua [screenshot lama](../screenshots/README.md) dibuka langsung; gambar dipakai untuk evaluasi proporsi, bukan kontrak fitur.

Source saat desain menyediakan **manual/auto/full**, berbeda dari PNG pengaturan lama dan penjelasan README yang belum mencakup full. Source server juga sudah menyediakan `state.terminals`; frontend belum mengonsumsinya. Kontrak source ini menjadi dasar, dengan fallback untuk backend lama. Nomor baris sengaja tidak dipakai karena checkout terus berubah.

Keputusan utama:

- Chat, keputusan, dan hasil menjadi pusat kerja. Pada 1440: sidebar 208 px, konten 1176 px, chat 808 px, rail kantor 344 px, gutter 24 px. Kantor tidak lagi menguasai layar; chat mendapat sekitar 70% area dua kolom.
- Krem/sage/ink dengan teks biasa. Canvas **asli** tetap digunakan, furnitur/sprite dan alur datang–pergi tidak diganti. Teks dalam Canvas bersifat dekoratif; daftar orang di bawah adalah sumber label/status terbaca dan kontrol keyboard setara.
- Konteks workspace dan aturan HEAD muncul sebelum tujuan pertama; izin selalu menyebut peminta, tugas, provider, path dan cakupannya. Tidak ada approval baru secara otomatis.
- Hasil, gagal, terputus, dan dihentikan mudah ditemukan di Riwayat. Worker hanya-baca. Terminal selalu menyebut workspace shell sendiri.
- Satu PM per workspace/provider, freelancer sementara. Tidak menambah staf permanen, XP, departemen, ranking, dashboard besar, provider/model baru, mode backend baru atau biaya per agent.

## 2. Artefak review

[Prototype HTML standalone](prototype.html) dibuka langsung di browser, tanpa build/server. Tab DEMO di atas adalah navigasi skenario desain, bukan navigasi produk final. Semua percakapan, status, path, izin, kuota, branch, commit dan output adalah fixture; tidak membaca filesystem/API aplikasi, tidak memanggil provider atau membuka shell. CSP memblokir koneksi. Renderer kantor ditranspilasi dari `web/office.ts` dan di-inline ke prototype tanpa perubahan sumbernya. Tidak ada aset/font jaringan atau gambar generatif.

| Artefak | Yang dinilai PM |
| --- | --- |
| [Desktop 1440](previews/desktop.png) | Hierarki chat/izin/kantor, konteks workspace, hasil perlu ditinjau |
| [Tablet 768](previews/tablet.png), [kantor dibuka](previews/tablet-office.png) | Chat satu kolom, sidebar ringkas, Canvas dapat dilipat |
| [Mobile 390](previews/mobile.png), [kantor dibuka](previews/mobile-office.png) | Chat dahulu, akses workspace/kuota/settings tetap tersedia |
| [Reflow 320](previews/reflow.png) | Tombol, path, heading dan kartu membungkus tanpa kehilangan isi |
| [Pengaturan](previews/settings.png), [390](previews/settings-mobile.png), [320](previews/settings-reflow.png) | Manual/auto/full, lingkup global, penyimpanan per bagian |
| [Konfirmasi full](previews/permission-full.png) | Konsekuensi tanpa sandbox dan ringkasan provider |
| [Pemulihan](previews/recovery.png), [320](previews/recovery-reflow.png) | Review sebelum resume, hasil dan log hanya-baca |
| [Katalog state](previews/states.png), [terminal mobile](previews/terminal-mobile.png) | Pertanyaan vs izin, JSON invalid, error/koneksi, terminal |

Preview utama full-page; tinggi isi dapat melebihi viewport. Screenshot dialog memakai viewport agar panel/fokus dan backdrop terlihat. Buka prototype untuk mencoba dialog, chooser, fold kantor, JSON invalid dan pemilihan jawaban. Tombol berlabel demo memberi feedback lokal; tidak mensimulasikan keberhasilan backend. Tidak semua kontrol prototype fungsional: CRUD, streaming, xterm, diff/resume/merge hanya representasi.

## 3. IA dan alur utama

**Shell:** Workspace (nama + path lengkap), koneksi, Riwayat, Terminal beserta jumlah sesi aktif, Pengaturan dan kuota akun. Workspace bernama sama dibedakan path, bukan hover. Path membungkus atau tersedia pada panel konteks dengan tombol “Salin path”; copy melalui clipboard browser dengan fallback pilih teks. Tidak menawarkan open-file OS tanpa API.

**Ruang utama:** header percakapan `PM · Codex/Claude`, chooser dikelompokkan PM / Sedang bekerja / Riwayat freelancer; transcript; keputusan workspace aktif; composer PM. Rail berisi kantor + daftar freelancer aktif, Perlu ditinjau, pintasan Riwayat. Jumlah Perlu ditinjau juga menjadi akses di toolbar mobile agar tidak tenggelam di bawah percakapan.

**Detail tugas:** judul, peran/provider/status/waktu → hasil atau error → log → folder eksekusi/branch/baseCommit bila ada → diff → resume/stop/merge bila tersedia. Ini dapat berupa halaman/panel lokal dalam shell, tidak memerlukan rute server baru. Riwayat memuat semua task nonaktif, bukan hanya sukses.

**Pengaturan:** Izin global; Workspace & provider; Lanjutan; Jadwal pekerjaan. Kuota tetap informasi akun sekunder. Terminal panel terpisah dari percakapan dan dari konteks pemilihan workspace.

Alur yang harus diimplementasikan:

1. **Pertama buka:** “Belum ada workspace” → “Pilih folder workspace” → picker (Naik, Home, path manual, folder tersembunyi, subfolder) → “Gunakan folder ini” → simpan roots → aktifkan workspace. Error picker tidak menghapus path; tanpa subfolder tetap dapat memilih folder itu. Bila perubahan settings ditolak karena agent/terminal aktif, alasan tampil inline; tidak menghentikan proses diam-diam.
2. **Sebelum tujuan pertama:** konteks path + “Freelancer Git mulai dari commit terakhir. Perubahan lokal yang belum di-commit tidak ikut.” Detail menjelaskan initial commit untuk Git baru dan serialisasi folder non-Git yang tumpang tindih. Panduan statis; tanpa indikator dirty/HEAD atau ajakan commit otomatis. Pada kunjungan berikutnya ringkas namun tetap dapat dibuka.
3. **Beri tujuan:** composer menyebut workspace dan provider; input biasa → `pm/messages`; berhasil → transcript, status kerja, freelancer muncul bila API mencatatnya. Draft dipertahankan bila gagal. Pergantian workspace/provider menyimpan draft **per pasangan** dalam memori UI; tidak menjanjikan draft bertahan reload. Data chat tetap satu sesi per workspace/provider yang sudah ada.
4. **Menunggu keputusan:** jumlah pending semua task di workspace tetap terlihat meskipun chat worker lain dipilih. Klik requester membuka tugas yang benar. Kelompok “Pertanyaan” dan “Izin tindakan” terpisah bila keduanya ada; tidak menyatakan semua waiting berarti izin. Keputusan tidak menutupi composer permanen; daftar panjang mengikuti scroll dokumen/panel yang dapat diakses, dengan link “Lihat N permintaan”.
5. **Selesai:** freelancer pergi dari Canvas; hasil tetap di Riwayat/chooser. Buka hasil → tinjau diff → konfirmasi merge bila completed dan branch ada. “Selesai” tidak diubah menjadi “Sudah digabung” tanpa bukti server. Tidak ada katalog artefak backend baru: path yang disebut result hanyalah teks kecuali API menyediakan tautan aman.
6. **Gagal/terputus:** tombol “Tinjau lalu lanjutkan” membuka hasil/error/log/diff. Resume dilakukan eksplisit dari detail, tanpa retry/failover model otomatis. Cancelled tampil “Dihentikan”, tetap dapat ditinjau/resume, tidak memakai alarm gagal.

## 4. Sistem visual

Gunakan variabel semantik, bukan warna per halaman. Warna menyampaikan konteks bersama teks/simbol; bukan satu-satunya indikator.

| Token | Nilai | Pemakaian |
| --- | --- | --- |
| background | `#F5F3EC` | Krem halaman |
| surface | `#FFFEF9` | Chat, form, dialog |
| surface-subtle | `#EEEEE5` | Sidebar |
| sage | `#E5EBDF` | Status tenang, pemilihan |
| ink | `#263D33` | Heading/body |
| muted | `#5D685E` | Metadata fungsional |
| border | `#D6DACE` | Pemisah dekoratif; bukan satu-satunya batas input |
| control-border | `#7B8B70` | Input/textarea/select agar batas dapat dikenali |
| action | `#355C48` + putih | CTA kirim/simpan/lanjutkan |
| warning | `#76501B` / `#F6EDD9` | Menunggu izin, konsekuensi |
| danger | `#973E35` / `#F7E7DF` | Error, terputus; tetap berlabel |
| focus | `#235B88` | Outline 3 px, offset 3 px |
| terminal | `#202F28` / `#E4EFDC` | Shell/output |

Kontras dihitung dari luminansi sRGB: ink/surface **11,57:1**, muted/surface **5,77:1**, muted/background **5,24:1**, putih/action **7,57:1**, warning/pale **6,15:1**, danger/pale **5,71:1**, focus/surface **7,11:1**. Target teks biasa ≥4,5:1, elemen nonteks/fokus ≥3:1. Border card tipis dekoratif tidak dipakai sebagai indikator tunggal kontrol. Setelah warna diturunkan ke source, ukur ulang semua state hover/disabled/error; ini bukan sertifikasi WCAG.

Tipografi: system sans (`Inter` hanya bila sudah tersedia lokal, fallback system-ui), body/chat **15/24–25 px**, input mobile **16/24 px**, h1 **24/30** (mobile 22/28), h2 **19/26**, h3 **16/24**, label **14/20**, metadata **13/20**, badge/eyebrow **12/18**. Tidak ada font pixel untuk teks fungsional. Monospace **13/20** untuk path/command/diff. Lebar pesan maksimal **72ch**; output code dapat horizontal scroll hanya dalam blok bila whitespace harus dipertahankan, dengan label/fokus yang jelas.

Spacing dasar **4 px**; skala 4, 8, 12, 16, 20, 24, 28, 32, 40. Padding card/chat 22–24 desktop, 16 mobile; permission card 16–18 (mobile 13–16), antarblok 16/24, antarlabel-input 6/8. Radius kontrol 7–8, card 10–12, badge 5. Shadow halus `0 5px 18px #263D3305`; tidak bergantung shadow untuk membedakan panel. CTA utama hanya satu per grup keputusan; tindakan destruktif warna danger dengan copy eksplisit.

## 5. Grid, scroll, mobile dan fokus

| Rentang | Layout dan urutan |
| --- | --- |
| ≥1200; acuan 1440 | Sidebar 208; padding main 28; chat fleksibel min-width 0; rail 344; gap 24. Header konteks melintasi konten. Canvas 720×420 diskalakan proporsional tanpa crop. Di ≥1600 batasi main 1440 dan rail 380. |
| 600–1199; acuan 768 | Sidebar 176, main padding 22; chat satu kolom dahulu. Kantor dapat dibuka dengan “Lihat kantor”, Canvas maksimal 540; daftar orang tetap tampil. Perlu ditinjau setelah chat; link jumlah di konteks boleh dipakai semua ukuran. Settings menjadi satu kolom dengan anchor yang wrap. |
| ≤599; acuan 390 | Sidebar pindah ke panel Workspace & akun. Header nama/path, koneksi tetap tampil, toolbar wrap (Workspace, Perlu ditinjau, Riwayat, Terminal, Pengaturan). Chat → daftar orang/kantor → detail pendukung. Kuota/refresh ada di panel Workspace & akun. Tidak memaksakan Canvas di atas chat. |
| 320 CSS px | Padding main 12, ruang efektif 296; judul/path/teks tombol wrap, permission actions beberapa baris. Tidak ada kolom tersembunyi yang menyimpan tindakan esensial. Settings dan recovery juga diuji lebar ini. |

Scroll prototype sengaja mengikuti dokumen agar seluruh desain bisa direview. Untuk implementasi: default gunakan alur dokumen seperti prototype; jangan mengembalikan chat fixed 620 px. Jika desktop memakai transcript berscroll, gunakan min-height 0, tinggi berbasis `100dvh`, area keputusan dengan batas tinggi dan akses keyboard, composer tetap terjangkau; jangan menjadikan nested scroll syarat membaca error. Mobile gunakan document scroll, bukan fixed-bottom composer yang menutup isi. `visualViewport`/`dvh` dapat membantu saat keyboard; `scrollIntoView({block:'nearest'})` hanya saat fokus/input/aksi pengguna, bukan tiap SSE. Safe-area bottom 16 + env bila composer sticky dipilih kemudian. Jangan autofocus saat initial load/mobile dan memunculkan keyboard tanpa aksi.

Ketika membaca pesan lama, SSE tidak memaksa scroll ke bawah. Tampilkan tombol “Pesan baru” dari event lokal yang belum dibaca, tidak membutuhkan backend unread. Memuat pesan lama mempertahankan anchor/offset; output details tetap terbuka. Status update tidak mengganti fokus, selection atau draft.

Keyboard: Tab sesuai DOM/logika visual, Enter/Space tombol, Escape dialog, Enter pada composer kirim hanya bila bukan IME/composition dan bukan repeat; Shift+Enter newline. Worker tidak punya composer. Dialog native `showModal`, `aria-labelledby`, isi dapat scroll, fokus awal judul `tabindex=-1` atau Tutup/aksi aman; Tab tertahan, Escape/tutup kembali ke pemicu yang masih ada. Jika pemicu hilang setelah task selesai, fokus ke heading daftar terdekat. Tidak memberi fokus awal pada Izinkan/Gabungkan/Hentikan. Dialog nested lebih baik diganti panel dengan Back dan judul daripada dua modal bertumpuk; prototype mengganti isi dialog tunggal.

Update DOM parsial atau restore dengan key task/approval/control, bukan seluruh app tanpa pemulihan. `role=status` polite untuk koneksi/status/keberhasilan, `role=alert` untuk gagal submit, bukan transcript streaming keseluruhan. Pesan dapat dinavigasi melalui heading/label speaker; timestamp semantik. Live announcement singkat “Penulis docs menunggu izin”, tidak membaca tool output panjang. Target sentuh tombol utama ≥44×44; link teks inline dapat lebih kecil dengan jarak memadai (target WCAG minimal 24 atau pengecualian inline). Semua tindakan Canvas memiliki padanan tombol orang. Reduced motion menonaktifkan gerak seperti source; status tetap terbaca tanpa animasi. Evaluasi xterm screenReaderMode dan keyboard saat implementasi, jangan mengklaim sudah lolos screen reader.

## 6. Spesifikasi komponen dan copy

### Konteks, chat, kantor

Workspace chip: nama bold + path monospace/wrap; jika belum terdaftar “Belum ada workspace”, CTA “Pilih folder workspace”. Provider PM terletak di header dan composer. Hint pergantian: **“Mengganti provider membuka percakapan terpisah. Percakapan lama tetap tersimpan.”** Memilih workspace terdaftar tidak mengubah settings global; menambah/menghapus roots mengikuti blokir settings.

Chooser: satu baris per task berisi peran, judul, provider, status, updatedAt; ID pendek sebagai pembeda bila judul kembar. Group heading bukan roster staf. Klik orang Canvas atau tombol teks memilih task yang sama; tampilkan nama penuh di daftar meski label Canvas terpotong asli. Aktif = queued/running/waiting. Selesai/gagal/dihentikan/terputus keluar kantor dan masuk Riwayat. PM tetap terlihat meski idle; gunakan “Siap” hanya state UI tanpa task, bukan status backend baru. Meja kosong kapasitas visual, bukan tombol rekrut permanen.

Chat bubble tidak menyamakan instruksi PM dengan worker output. Tool/output collapsed default dengan label, exitCode bila ada; preview memakai text nodes seperti renderer sekarang. “Muat pesan sebelumnya” tetap ada; loading dan gagal tampil dekat tombol, pesan yang sudah ada tidak dibuang. `/compact` ada di toolbar chat dan bantuan; enabled setelah sessionId tersedia dan giliran running/queued selesai, server tetap sumber validasi. Copy sukses/gagal compaction dari event, bukan menghapus riwayat. Unknown slash: “Perintah belum didukung. Buka Bantuan perintah.”

Stop PM: “Hentikan PM” → konfirmasi **“Hentikan PM dan anak aktif?”**, jelaskan semua anak aktif ikut berhenti, CTA “Hentikan PM & anak aktif”, aksi aman “Kembali”. Worker stop menyebut peran dan hanya worker itu. Tidak menambahkan autosave/undo stop yang tidak ada.

### Keputusan: tidak boleh kehilangan semantik provider

Kartu wajib menampilkan jenis (Pertanyaan / Izin tindakan / Konfirmasi), requester `role/PM`, task title + link, provider, workspace asal, folder eksekusi bila tersedia, serta hitungan pending workspace. Request tanpa task yang ditemukan tidak boleh dikaitkan ke chat terpilih: tulis “Peminta tidak ditemukan” + ID, tawarkan refresh; jangan menebak peran. Card tidak dipindah konteks saat chooser berubah.

- **Izin tindakan:** judul dari `approvalView`; command, cwd/path, host dan preview ditampilkan persis. `white-space:pre-wrap` boleh membungkus visual; tombol Salin menyalin string asli, bukan versi wrap/terjemahan. Tidak menyingkat dengan ellipsis, membersihkan flag, mengubah kutip, mengganti host/path atau membuat ringkasan sebagai satu-satunya bukti. Tampilkan placeholder “Tidak disediakan provider” bila field penting tidak ada; jangan mengisi executionPath sebagai cwd permintaan tanpa label sumber berbeda.
- **Opsi provider:** gunakan hasil `approvalChoices`, kirim ID choice yang sama. Sekali/tolak/batal terlihat; opsi sesi/aturan bisa dalam disclosure berlabel hitungan, semua tetap dapat ditemukan dengan keyboard. Preview scope tetap persis, tampil sebelum tombol terkait; tidak ada opsi default terpilih, Enter pada card tidak menyetujui. Codex mempertahankan accept, acceptForSession, decline, cancel dan amendment command/network yang ditawarkan. Jelaskan sesi selama proses app-server; giliran baru dapat membuat proses baru. Claude mempertahankan tujuan `session`, `localSettings`, `projectSettings`, `userSettings`; aturan yang disembunyikan provider tetap tidak ditampilkan. Jangan mengarang scope jika provider tidak menawarkan.
- **Pertanyaan:** “Perlu jawaban Anda”; opsi berlabel dan deskripsi mengisi textarea saja, boleh diedit. “Kirim jawaban” disabled ketika kosong/busy. Banyak pertanyaan tetap bernomor sesuai payload; jangan mengubahnya menjadi schema sendiri. Penolakan tetap tersedia sesuai alur existing. Pemilihan tidak mengirim atau menyetujui.
- **Izin `ask_user`:** “Izinkan pertanyaan ini?”; CTA “Tampilkan pertanyaan”. **“Izin ini membuka pertanyaan berikut. Jawab setelah ditampilkan; pekerjaan belum disetujui.”** Ini tidak dianggap jawaban pengguna.
- **Konfirmasi tanpa field:** CTA “Konfirmasi” atau “Tampilkan pertanyaan”; kirim `answer:'{}'` seperti source, bukan form palsu.
- **Form schema:** tampilkan requestedSchema dalam disclosure, contoh hanya diturunkan dari schema yang benar-benar ada; JSON editor tetap fallback. Parse error inline **“JSON belum valid. Periksa tanda kutip dan koma.”**, `aria-invalid`, fokus input, payload tetap ada. Validasi schema/server tetap otoritatif; jangan menciptakan field mandatory dari asumsi. Auth URL bila ada ditampilkan lengkap sebagai tautan eksplisit, bukan auto navigation/auto login.
- **Unsupported permissions:** “Perubahan izin belum didukung”; tidak ada CTA approve; “Tutup permintaan” mengirim penolakan yang ada. Approved/denied/expired tidak lagi actionable; bila race/stale, refresh dan tampilkan “Permintaan sudah diputuskan atau kedaluwarsa”, tanpa replay klik.

Busy menonaktifkan semua tombol kartu selama submit. Gagal tetap menyimpan jawaban/catatan dan expansion, error persisten di kartu + “Coba lagi”; tidak mengandalkan toast sembilan detik. Submit tidak diulang otomatis ketika koneksi pulih. Perubahan izin otomatis yang sudah dibuat server dapat ditandai `automatic:true` bila record/event tersedia; jangan menebak audit yang tidak dikirim.

### Pengaturan izin dan batas simpan

Ketiga mode tetap memakai nilai server `manual`, `auto`, `full`, terpisah Codex/Claude. Untuk produksi, kedua provider mendapat fieldset dengan penjelasan setara; prototype menunjukkan fieldset Codex dan select ringkas Claude dengan konsekuensi tertulis. Nilai awal dari respons settings, default manual **hanya** bila field optional tidak ada dan capability mendukung. Jangan mengubah mode hanya karena halaman dibuka.

| Pilihan | Copy konsekuensi yang harus dekat kontrol |
| --- | --- |
| Manual | “Minta keputusan saat provider memerlukan izin.” |
| Otomatis | “Izinkan sekali permintaan perintah, file, tool dan konfirmasi izin tool-call tanpa klik, termasuk yang sedang menunggu. Tidak membuat aturan permanen otomatis. Pertanyaan, form data dan autentikasi tetap perlu input; batas paksa provider tetap berlaku.” |
| Akses penuh · berisiko | “Agent berjalan dengan hak user laptop. Codex memakai never + danger-full-access; Claude memakai dangerously-skip-permissions tanpa sandbox.” Tidak menjanjikan sandbox atau isolasi container. |

Selalu tulis **“Berlaku untuk PM dan freelancer provider ini di semua workspace.”** Ringkasan sebelum simpan `Codex: mode lama → baru`, `Claude: lama → baru`, efek pending bila auto, konsekuensi bypass bila full. Satu CTA “Simpan izin”. Untuk perubahan dari/ke full tampilkan konfirmasi sadar dengan mode/provider/cakupan; tidak ada checklist ritual, tidak ada auto-stop, tidak ada default CTA menyetujui. Blokir mengikuti backend: peralihan dari/ke full memerlukan **agent provider terkait** tidak running; manual↔auto tetap dapat disimpan saat agent/terminal aktif. Jangan memblokir semua settings izin karena terminal hidup.

“Simpan workspace & provider” hanya mengubah roots/coordinatorProvider/workerProvider; “Simpan lanjutan” maxWorkers 1–10 dan model. API PUT masih menerima objek Settings penuh: merge **hanya field bagian yang disimpan** dengan state terbaru dari server, bukan seluruh form lain yang belum disimpan. Tampilkan error konflik/pembaruan jika versi berubah ketika form terbuka; tidak ada janji atomic compare-and-swap karena API tidak punya version/ETag. Sukses hanya setelah respons cocok dan refresh: **“Izin disimpan.”**, **“Workspace & provider disimpan.”**, **“Pengaturan lanjutan disimpan.”** Nilai belum tersimpan ditandai teks. Error tidak menutup dialog atau menghapus input.

Access settings (roots/provider/model/limit) terblokir bila engine running/locked atau terminal aktif seperti server; jelaskan **“Selesaikan atau hentikan agent dan terminal aktif sebelum mengubah bagian ini.”** UI boleh pre-disable dari state yang tersedia, tetapi lockedTasks tidak diekspos: server tetap final, error ditampilkan inline. Capability `permissionModes` absen/false: kontrol izin tidak dapat disimpan, **“Backend ini belum mendukung pengaturan izin.”** Tawarkan bantuan pembaruan saat pekerjaan idle, bukan restart otomatis.

### Hasil, Git dan pemulihan

Peran + judul + provider + status + updatedAt konsisten di daftar aktif/riwayat/chooser. Hasil memakai `task.result`, error `task.error`. Kosong: “Belum ada hasil akhir.” Jangan menyimpulkan gagal dari result kosong. Tampilkan executionPath bila ada, fallback workspace dengan label **“Workspace (folder eksekusi belum tersedia)”**; branch/baseCommit hanya bila ada. UI tidak menjanjikan membaca perubahan lokal workspace asal.

“Tinjau lalu lanjutkan” adalah navigasi ke detail, bukan resume API. Di detail **“Lanjutkan {peran}”** mengirim resume, status berubah dari server. Failed: tampilkan error persisten; interrupted: “Sesi terputus. Tinjau aktivitas dan perubahan sebelum melanjutkan.” Cancelled: “Tugas dihentikan. Riwayat tetap tersimpan.” Izin lama sesudah crash kedaluwarsa; permintaan baru perlu keputusan baru. Tidak ada retry otomatis.

Diff memuat `diff`, `untracked`, `previews` existing; tampilkan loading/error/empty, label preview terbatas untuk file baru, bukan explorer penuh. CTA merge hanya completed dengan branch, setelah review dan konfirmasi. Copy **“Penggabungan membuat commit perubahan worker lalu merge ke checkout asal yang bersih. Merge akhir belum di-commit; tinjau dan commit sendiri.”** Detail menyebut staging/commit worker, `git merge --no-ff --no-commit`, konflik/worktree dipertahankan dan `git merge --abort`. Setelah API sukses tampilkan pesan server, jangan membuat status permanen integrated baru. Merge ditolak/konflik: error tetap di panel, diff/log dapat dibuka; tidak menawarkan force merge/auto abort.

### Terminal, kuota, jadwal

Terminal heading **“Terminal · {workspace shell}”**, path lengkap tetap terlihat walaupun workspace utama berganti. Badge utama menghitung summary `exitCode===null` dan menjelaskan workspace masing-masing di panel. State hidden UI tidak disamakan stopped. Pilih terminal dari workspace lain membuka sesi itu dengan path aslinya; tidak merelabel shell lama. Tidak menulis `cd` otomatis. Pada `!perintah` tampil hint dekat composer sejak awal **“Langsung ke shell, bukan pesan PM”**; `show(command)` memang mengirim newline seperti source, jangan menambah persetujuan model palsu. Output tidak masuk PM. `/terminal`, Ctrl+C, resize dan password tetap fungsi xterm existing.

Panel boleh nonmodal desktop agar bisa memeriksa chat; mobile dialog layar hampir penuh dengan title/control bar wrap, area xterm scroll internal. “Sembunyikan” mengembalikan fokus ke Terminal dan meninggalkan shell hidup. “Hentikan terminal” menutup sesi eksplisit. Error poll menonaktifkan input, menampilkan **“Koneksi terminal terputus. Shell mungkin masih hidup.”** “Coba hubungkan kembali” memakai GET ID/cursor yang sama dulu. Jangan reset ID dan POST shell baru pada kegagalan jaringan. Sesi tak ditemukan/daemon restart → “Sesi terminal tidak tersedia. Output lama tidak dapat dipulihkan.” → “Buka terminal baru” eksplisit. `state.terminals` dapat dipakai rekonsiliasi; backend lama tanpa summary hanya menunjukkan sesi yang diketahui tab, dengan label keterbatasan. Buffer terpangkas ditandai. Tidak menyebut shell bersandbox.

Kuota: **“Penggunaan seluruh akun”**, bukan biaya app/per freelancer; nilai % terpakai, window label, reset dan updatedAt terlihat tanpa hover, timezone tampil (`WIB` untuk Asia/Jakarta atau label zona pengguna). Available = angka nyata; stale = angka terakhir + “Data terakhir · kedaluwarsa” + note; unavailable = penjelasan, tanpa progress 0%; loading mempertahankan data lama bila ada. Refresh tersedia desktop/mobile, busy dan cooldown 15 detik dijelaskan. Tidak mengubah cache/polling existing 60 detik atau membaca kredensial browser.

Jadwal sekunder tetap menyediakan tambah/ubah/jeda/aktifkan/hapus, nama/prompt/workspace/provider/cron/timezone; model dipertahankan dari data bila edit. Cron lima field numerik; contoh **“0 9 * * 1-5 · Senin–Jumat pukul 09.00”**, zona waktu input jelas. Jangan menyajikan natural-language builder/next run yang tidak ada. Daemon harus berjalan, menit terlewat dilewati, run tidak ditumpuk saat sebelumnya aktif/terputus. Hapus meminta konfirmasi bernama jadwal; error tetap inline. Tidak menambahkan kalender atau scheduler baru.

## 7. Matriks state → data/aksi existing

Prefix semua endpoint `/api/`. State loading/error/draft/fold/focus adalah state frontend lokal, bukan penambahan enum task.

| State / layar | Bukti data dan aksi | Tampilan / fallback |
| --- | --- | --- |
| Startup loading/error | GET `state`, `settings.roots` | “Membuka Kantor…”; gagal “Kantor belum dapat dibuka” + Coba lagi; tanpa isi stale seolah valid |
| Tanpa workspace / picker | roots kosong; POST `folders` `{path?,hidden}`; PUT `settings` | Path manual/Naik/Home, loading/error per navigasi; hasil lama tidak dapat dipilih saat request baru belum siap |
| Workspace + HEAD | roots, task.workspace, executionPath, branch, baseCommit | Panduan statis. Tidak ada deteksi dirty/current HEAD API; jangan menampilkan commit terkini buatan |
| Chat belum mulai | Tidak ada PM untuk workspace+coordinatorProvider | “Apa yang ingin diselesaikan?” + contoh tujuan mengisi composer |
| Transcript loading/kosong/error | GET `tasks/:id/events?tail=1`, `?before=id`; eventCache lokal | Loading berbeda “Belum ada respons”; error inline + retry hanya fetch, pertahankan transcript lama |
| PM send | POST `pm/messages` `{workspace,text}` | Sending cegah double submit, gagal draft tetap ada; bila timeout hasil tidak pasti, refresh state/events sebelum kirim ulang eksplisit |
| Queued/running/waiting | Task.status + parentId, approvals pending | Mengantre/Bekerja/Menunggu. Alasan spesifik hanya dari approval/error yang tersedia; tidak membuat ETA/progress % |
| Pending workspace | Approval.taskId + inWorkspace task/parent, kind/details/status | Semua pending workspace, bukan hanya chat; requester selalu terlihat; task hilang → unknown + refresh |
| Jawaban / izin / form | POST `approvals` `{id,approved,answer,choice?}` | Parsing/opsi via approvalView/approvalChoices; invalid JSON/input tersimpan, busy, expired/nonpending tak actionable |
| Koneksi SSE | GET `events?after=cursor`, reconnect loop + state refresh | Terhubung/Menghubungkan kembali; stale warning. Poll 5 detik saat visible tetap kompatibel; bukan model retry |
| Worker log | Task.parentId, chatEntries, events/result/error | Hanya-baca; Kembali ke PM + Detail pekerjaan. Tidak ada endpoint direct worker composer |
| Failed/interrupted/cancelled | Task.status/result/error | Perlu ditinjau untuk failed/interrupted, cancelled di riwayat; POST `tasks/:id/resume` eksplisit sesudah review |
| Hentikan | POST `tasks/:id/cancel` | PM scope anak dijelaskan; worker scope sendiri; gagal tetap panel terbuka |
| Riwayat kosong/hasil | archive task nonaktif sorted updatedAt | “Pekerjaan yang selesai, gagal, terputus, atau dihentikan akan tersimpan di sini.”; tidak membuang cancelled |
| Diff/merge | GET `tasks/:id/diff`; POST `tasks/:id/merge` `{confirm:true}` | Preview terbatas, clean checkout syarat server, konfirmasi explicit, error/conflict persisten |
| Compact | sessionId/status; POST `tasks/:id/compact`; command events | Disabled tanpa sesi/running/queued, output/sukses/gagal tetap terlihat; validasi final server |
| Settings izin | capabilities.permissionModes, settings.permissions; PUT `settings` | Manual/auto/full per provider, scope semua workspace, pending effect; unsupported tidak berpura-pura tersimpan |
| Settings lain | roots/coordinatorProvider/workerProvider/maxWorkers/models | Merge per bagian dengan settings terbaru; blokir aktif/locked/terminal mengikuti error server |
| Kuota | GET `usage`, `usage?refresh=1`; status/windows/note/updatedAt/resetsAt | Loading/available/stale/unavailable berbeda; gagal jaringan tidak mengganti angka jadi nol |
| Jadwal | state.schedules; POST `schedules`, DELETE `schedules/:id` | CRUD existing, enabled; tanpa nextRun/riwayat run baru |
| Terminal opening/active/hidden | POST `terminals` `{workspace}`; GET `terminals/:id?after=cursor`; optional state.terminals | Opening lokal; active dari exitCode null; hidden state UI; tampil path sesi, bukan workspace terpilih |
| Terminal input/resize/end | POST `terminals/:id` action input/resize/close | Input langsung, serialize chunks seperti source; resize dari viewport panel; hide tidak mengirim close |
| Terminal error/ended | Poll error / error / exitCode / 404 | Input nonaktif, same-ID reconnect dulu; ended menampilkan exitCode; sesi hilang tawarkan baru eksplisit, tanpa janji recovery daemon |

## 8. Cakupan A1–A11 dan urutan implementasi

| ID | Penyelesaian desain | Prioritas / batas |
| --- | --- | --- |
| A1 | Context header/composer, picker, panduan HEAD dan non-Git, executionPath/baseCommit | P0; tidak ada dirty detection otomatis |
| A2 | Settings manual/auto/full, ringkasan, full confirmation, save per bagian/capability | P0; README perlu diselaraskan pemiliknya pada pekerjaan terpisah |
| A3 | Requester+task, pertanyaan/izin/form terpisah, opsi provider exact, inline errors | P0; JSON editor fallback sampai schema mendukung renderer field yang benar |
| A4 | Chat 808 px vs rail 344, chooser, draft workspace+provider, bantuan ! | P1; persist draft setelah reload ditunda karena bukan kontrak existing |
| A5 | Riwayat semua nonaktif, hasil/log/diff, review-resume, stop scope | P1; tidak ada integrated state buatan atau file explorer baru |
| A6 | Loading/error/reconnect dibedakan, feedback persisten, no resend otomatis | P1; tidak mengubah retry provider |
| A7 | 768/390/320 reflow, toolbar mobile/kuota panel, fold kantor | P1; OS keyboard nyata tetap perlu uji frontend |
| A8 | Token kontras, teks 13–15, target/fokus/dialog/live-region/reduced motion | P1; screen reader audit end-to-end masih pekerjaan implementasi |
| A9 | Grup settings dan semua kontrol jadwal tetap tersedia, hint provider dekat kontrol | P2 sebagian dibawa untuk kejelasan; calendar builder/natural-language cron/preview nextRun ditunda: tidak tersedia API dan mengalihkan P0/P1 |
| A10 | Scope seluruh akun, timestamp/reset zona, stale/unavailable, refresh mobile | P2 ringan dibawa karena mendukung keterbacaan; analitik historis/biaya per agent ditunda: data tidak ada dan di luar produk |
| A11 | Terminal context sendiri, summary aktif, hidden≠ended, same-ID recovery, xterm focus | P1; persist buffer lintas daemon ditunda karena API hanya memori |

Urutan frontend sesudah PM menyetujui: (1) konteks dan keputusan P0 beserta kontrak settings/izin; (2) shell/chat/worker/recovery/terminal; (3) responsive/focus/error; (4) pengelompokan settings/kuota ringan. P2 tidak menghambat penyelesaian P0, namun fitur existing tidak boleh dihapus dari navigasi. Penyempurnaan sprite, richer file previews dan kuota provider baru tidak termasuk tahap ini.

## 9. Bukti render, batas, dan handoff

Render lokal menggunakan Google Chrome headless melalui CDP dan profil sementara, file://, reduced motion aktif. Tidak memulai backend/daemon, tidak membaca database/credential, tidak menjalankan provider/terminal aplikasi, tidak mengubah source/build/runtime. [capture.mjs](previews/capture.mjs) dapat dijalankan `node docs/ux/previews/capture.mjs`; hanya menimpa artefak preview desain di direktori ini. Memerlukan Node 22 WebSocket dan `/usr/bin/google-chrome`. Flag no-sandbox hanya untuk proses browser capture lokal, tidak berhubungan dengan mode izin produk.

Hasil mesin di [render-checks.json](previews/render-checks.json): 14 screenshot, seluruh viewport tanpa overflow horizontal; Canvas asli tersedia lebar intrinsik 720; tidak ada page error JS. Interaksi yang diperiksa: pemilihan opsi mengisi tanpa submit, JSON invalid dipertahankan/fokus, fokus awal dialog aman, penutupan mengembalikan fokus ke pemicu terlihat. Rasio token dihitung terpisah dari formula luminansi sRGB. Semua preview utama diperiksa visual untuk proporsi, wrap, keterbacaan dan dialog; setelah penyesuaian kontrol/fokus, render diulang.

Batas bukti: fixture bukan runtime integrasi. Belum menguji provider permissions nyata, kuota/live SSE, Git merge, race server, OS keyboard, zoom browser 400%, pembaca layar, xterm interaktif atau usability pengguna. Reflow320 adalah pemeriksaan CSS, bukan klaim lulus semua WCAG. Prototype tidak menyediakan backend baru; state katalog terpisah tidak boleh ditampilkan seolah simultan pada produk. Renderer Canvas asli mempertahankan teks pixel kecil; daftar teks aksesibel wajib, bukan mengandalkan label internal Canvas.

Handoff Frontend setelah review PM:

- Gunakan token, struktur dan copy di atas; pindahkan ke modul web yang sesuai, tidak menyalin JS fixture atau navigasi DEMO ke aplikasi.
- Pertahankan formatter text-node, `approvalView`, `approvalChoices`, `inWorkspace`, `freelancers`, `archive`, renderer Canvas dan seluruh kemampuan existing. Jangan mengubah payload choice/scope, menyatukan pertanyaan dengan approval, atau mengirim keputusan karena redraw.
- Review ulang kontrak CURRENT source sebelum mulai karena terdapat banyak perubahan lokal orang lain. API mismatch harus memakai fallback/capability, tidak diam-diam menerima perubahan izin.
- Uji alur P0 terlebih dahulu: dua workspace basename sama; HEAD guide; provider switch/draft; request worker saat PM dipilih; semua opsi Codex/Claude termasuk scope aturan; pending berubah saat submit; auto vs full dan blokir idle. Gunakan fixture terisolasi, tanpa real provider kecuali penugasan terpisah.
- Verifikasi 1440/768/390/320, keyboard/Escape/focus sesudah SSE redraw, panjang path/command dan beberapa pending; test loading/error/reconnect tidak menghapus draft atau menggandakan send. Uji terminal A → workspace B → hide/reopen/error tanpa mengganti konteks shell; kuota tidak ada bukan nol; failed/interrupted/cancelled tetap dapat ditemukan.
- PM menilai preview dan menyetujui arah sebelum Frontend ditugaskan. Dokumen/prototype ini tidak memberi persetujuan deploy/merge/publish. Tidak ada source, laporan analis, README, package, `.git`, runtime atau data produksi yang diedit dalam tugas desain ini.
