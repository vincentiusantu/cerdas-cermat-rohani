# Aplikasi Cerdas Cermat Rohani

Aplikasi kuis dua ronde untuk tiga kelompok, dengan papan skor, soundboard,
ekspor CSV, dan penyimpanan MySQL ternormalisasi.

## Menjalankan

```bash
mysql -u root -p < schema.sql     # buat database \\\& tabel
cp .env.example .env              # sesuaikan user/password MySQL atau buat manual file .env
npm install
npm start
```

Buka `http://localhost:3000`. Aplikasi mendeteksi sendiri bahwa ia dilayani
server ini, jadi langsung tersambung ke MySQL tanpa konfigurasi tambahan.

## Alur permainan

**Ronde 1 — Soal Berbobot (10 soal).** Tema dan bobot tampil lebih dulu. Tiap
kelompok memilih *Jawab* atau *Lewat*. Setelah semua menentukan, soal pilihan
ganda A–D dibuka dan operator mencatat jawaban tiap kelompok. Benar menambah
poin sebesar bobot, salah mengurangi sebesar bobot, lewat tidak mengubah apa pun.

**Klasemen.** Muncul otomatis di pergantian ronde. Nilai bisa disunting lewat
tombol **Edit nilai**; selisihnya dicatat sebagai koreksi juri sehingga poin asli
kedua ronde tetap utuh di database.

**Ronde 2 — Rebut Kotak (16 kotak).** Kelompok memilih kotak. Jika jawabannya
benar, poin langsung diberikan dan kotak selesai. Jika salah, kelompok itu gugur
untuk soal tersebut dan **kotak tetap terbuka** — soal direbutkan ke kelompok
lain. Bila ketiganya salah, soal hangus tanpa poin bagi siapa pun.

## Struktur database

Dua belas tabel dan dua view. Nilai tidak disimpan ganda; total dihitung dari
percobaan jawab ditambah koreksi juri.

|Tabel|Isi|
|-|-|
|`events`|identitas acara|
|`sessions`|satu kali permainan, dengan status persiapan → selesai|
|`teams`|tiga kelompok peserta, per sesi|
|`rounds`|konfigurasi tiap ronde, termasuk poin per kotak|
|`r1\\\_questions`|soal Ronde 1: tema, bobot, pertanyaan|
|`r1\\\_options`|pilihan A/B/C/D dan penanda kunci|
|`r1\\\_attempts`|keputusan jawab/lewat, jawaban, dan poin tiap kelompok|
|`r2\\\_questions`|soal Ronde 2 dan kuncinya|
|`r2\\\_cards`|status tiap kotak: tertutup, terbuka, terjawab, hangus|
|`r2\\\_attempts`|tiap percobaan dengan nomor urut rebutan|
|`score\\\_adjustments`|koreksi nilai manual dari juri|
|`ui\\\_state`|posisi tampilan operator agar bisa disambung ulang|

|View|Isi|
|-|-|
|`v\\\_team\\\_scores`|poin ronde 1 + ronde 2 + koreksi = total|
|`v\\\_leaderboard`|klasemen berperingkat per sesi|

## Endpoint

|Metode|Alamat|Kegunaan|
|-|-|-|
|GET|`/api/health`|cek MySQL, jumlah tabel, sesi aktif|
|GET|`/api/state`|rakit state dari seluruh tabel|
|PUT|`/api/state`|pecah state ke tabel-tabel dalam satu transaksi|
|GET|`/api/leaderboard`|klasemen dari view|
|POST|`/api/adjustments`|catat koreksi nilai|
|GET|`/api/history`|daftar sesi yang sudah selesai|
|POST|`/api/sessions/finish`|tutup sesi dan buka sesi baru yang bersih|
|GET|`/api/export/leaderboard.csv`|klasemen siap Excel|
|GET|`/api/export/detail.csv`|detail kedua ronde siap Excel|

## Bila server mati

Aplikasi tetap berjalan penuh dari localStorage. Cadangan lokal bertahan
**2 hari** sejak penyimpanan terakhir, lalu dibersihkan sendiri. Status koneksi
dan sisa masa simpan tertera di bawah papan permainan.

## Tanpa server sama sekali

`public/index.html` bisa dibuka langsung dengan klik dua kali. Semua fitur
berjalan kecuali penyimpanan MySQL; ekspor dan impor CSV tetap berfungsi.

