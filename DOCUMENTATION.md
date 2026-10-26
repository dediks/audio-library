# Audio Lab — Dokumentasi Lengkap Sistem & Audio QC Engine

Selamat datang di dokumentasi resmi **Audio Lab (Batch Ingestion & Soundsystem QC Engine)**. Dokumen ini dirancang sebagai panduan komprehensif untuk audio engineer, teknisi FOH/soundsystem, dan programmer.

---

## Daftar Isi
1. [Ikhtisar Proyek & Filosofi Desain](#1-ikhtisar-proyek--filosofi-desain)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Struktur Direktori](#3-struktur-direktori)
4. [Prasyarat & Instalasi](#4-prasyarat--instalasi)
5. [Panduan Penggunaan Web UI](#5-panduan-penggunaan-web-ui)
6. [Panduan Penggunaan CLI (`audio_manager.py`)](#6-panduan-penggunaan-cli-audio_managerpy)
7. [Spesifikasi Format & Mekanisme Smart Fallback](#7-spesifikasi-format--mekanisme-smart-fallback)
8. [Standar Audio QC & Metrik Soundsystem](#8-standar-audio-qc--metrik-soundsystem)
9. [Dokumentasi REST API Internal](#9-dokumentasi-rest-api-internal)
10. [Troubleshooting & FAQ](#10-troubleshooting--faq)

---

## 1. Ikhtisar Proyek & Filosofi Desain

Audio Lab diciptakan untuk memecahkan dua masalah besar dalam operasional audio profesional:
1. **Fidelitas Ingestion:** Mengunduh materi audio berizin dari YouTube / YouTube Music dengan kualitas setinggi mungkin tanpa kompresi berulang (*zero generation loss*).
2. **Kesiapan Soundsystem Panggung (FOH QC):** Mengaudit sinyal audio secara objektif sebelum diputar di sound system skala besar untuk mencegah distorsi inter-sample DAC, lonjakan dinamika berbahaya, dan kliping amplifier.

### Prinsip Utama:
* **Zero Dependency Eksternal:** Backend berjalan di atas Python murni (`http.server`, `threading`, `subprocess`), memanfaatkan `ffmpeg` dan `yt-dlp` tanpa perlu framework berat seperti Flask, FastAPI, atau Node.js.
* **Keamanan Maksimal:** Web server diikat secara ketat hanya pada interface lokal `127.0.0.1` (localhost). Frontend menggunakan Vanilla JS dengan manipulasi DOM yang aman (bebas XSS).
* **Non-Destruktif:** File audio asli tidak pernah dinormalisasi atau diubah secara otomatis; sistem hanya mengaudit dan memberi rekomendasi teknis kepada teknisi.

---

## 2. Arsitektur Sistem

Aplikasi ini menggabungkan antarmuka grafis modern, antrian pemrosesan latar belakang, dan mesin audit berbasis FFmpeg:

```
[ Pengguna di Browser ] ───► http://127.0.0.1:8765
                                  │
                                  ▼
                     [ web_ui.py : HTTPServer ]
                     (Strict Host: 127.0.0.1)
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
[ REST API Endpoints ]                           [ Thread Worker FIFO ]
• /api/system (Status Binary)                     (In-Memory Job Queue)
• /api/queue  (Live Logs & Progress)                       │
• /api/library (QC Explorer)                               ▼
• /api/download (Batch Ingestion)                 [ Subprocess: yt-dlp ]
• /api/scan (Trigger Full QC)                     • Ekstraksi AAC / Opus
                                                  • Pembacaan Cookie Chrome
                                                  • Simpan per Folder Playlist
                                                           │
                                                           ▼
                                                [ library/inbox/ ]
                                                           │
                                                           ▼
                                               [ Subprocess: FFmpeg ]
                                               • ebur128 (LUFS & LRA)
                                               • True Peak Filter (dBTP)
                                               • ffprobe (Codec & Bitrate)
```

---

## 3. Struktur Direktori

```text
audio-library-starter/
├── audio_manager.py       # Engine inti audit QC (FFmpeg) & downloader CLI
├── web_ui.py              # Server Web lokal, thread worker, & REST API
├── README.md              # Ringkasan cepat & panduan singkat
├── DOCUMENTATION.md       # Dokumentasi teknis lengkap (file ini)
├── library/
│   ├── downloaded_ids.txt # Arsip ID lagu untuk mencegah download duplikat
│   └── inbox/             # Direktori penyimpanan file audio hasil unduhan
│       ├── [Nama Playlist]/ # Subfolder otomatis per playlist
│       │   └── Trek 1.m4a
│       └── Single_Track.opus
└── static/
    ├── index.html         # Antarmuka dashboard (HTML5 semantik)
    ├── style.css          # Desain sistem bertema studio dark mode
    └── app.js             # Logika frontend (live polling, event handlers, DOM)
```

---

## 4. Prasyarat & Instalasi

### Kebutuhan Perangkat Lunak
* **Sistem Operasi:** Linux (Ubuntu, Debian, Fedora, Arch, dsb.) atau Windows/macOS.
* **Python:** Versi 3.10 atau yang lebih baru.
* **FFmpeg & ffprobe:** Terpasang di `PATH`.
* **yt-dlp:** CLI downloader versi terbaru.

### Verifikasi Instalasi
Jalankan perintah berikut di terminal:
```bash
python3 --version
ffmpeg -version
ffprobe -version
yt-dlp --version
```

Jika `yt-dlp` belum terpasang:
```bash
python3 -m pip install -U "yt-dlp[default]"
```

Jika `ffmpeg` belum terpasang di Linux (Debian/Ubuntu):
```bash
sudo apt update && sudo apt install -y ffmpeg
```

---

## 5. Panduan Penggunaan Web UI

### Menjalankan Server
Masuk ke folder proyek dan jalankan:
```bash
python3 web_ui.py
```
Akses melalui Google Chrome: **`http://127.0.0.1:8765`**

### Alur Ekstraksi Batch:
1. **Input URL:** Masukkan satu atau banyak URL YouTube / YouTube Music pada kotak textarea (satu URL per baris).
2. **Pilih Profil Format Audio:**
   * **PREMIUM AAC 256k:** Bitrate tertinggi YouTube Music (via sesi Chrome).
   * **NATIVE OPUS 48kHz:** Stream native murni Opus 48kHz tanpa kompresi ulang.
   * **MP3 320 KBPS:** CBR tertinggi untuk kompatibilitas flashdisk mobil / CDJ lama.
   * **MP3 VBR 0:** Alokasi bitrate dinamis profil LAME tertinggi.
3. **Konfigurasi Opsi:**
   * **Gunakan Sesi YouTube Premium (Google Chrome):** Aktifkan untuk membaca cookies akun Premium Anda.
   * **Simpan Playlist Otomatis per Folder:** Jika URL adalah playlist, otomatis dibuatkan folder dengan nama playlist.
   * **Otomatis Jalankan Audio QC:** Menghitung True Peak dan LUFS segera setelah unduhan selesai.
4. **Klik "Mulai Ekstraksi Batch":**
   * Pantau proses unduhan secara *real-time* melalui panel **Queue & Execution Monitor**.
   * Setelah selesai, daftar file akan otomatis muncul di tabel **Library Inbox & Soundsystem Readiness**.

---

## 6. Panduan Penggunaan CLI (`audio_manager.py`)

Selain antarmuka web, fungsionalitas penuh tersedia melalui perintah terminal:

### A. Download Konten
```bash
# 1. Download dengan Akun Premium Chrome + Folder Playlist Otomatis + QC:
python3 audio_manager.py download "URL_PLAYLIST" --authorized --format premium --cookies-from-browser chrome --playlist --scan

# 2. Download Native Opus Standar FOH (Publik):
python3 audio_manager.py download "URL_TRACK" --authorized --scan

# 3. Download MP3 320 kbps:
python3 audio_manager.py download "URL_TRACK" --authorized --format mp3 --scan
```

### B. Audit QC File Audio Lokal Saja (Tanpa Download)
Jika Anda memiliki folder koleksi audio sendiri dan ingin mengauditnya:
```bash
python3 audio_manager.py scan "path/ke/folder/audio" --out quality_report.csv
```
Hasil scan akan menghasilkan spreadsheet CSV lengkap berisi metrik teknis setiap file.

---

## 7. Spesifikasi Format & Mekanisme Smart Fallback

Untuk menjamin antrian download tidak pernah macet (*zero interruption*), sistem menerapkan **Arsitektur Fallback 2 Lapis**:

### Lapis 1: Fallback Format Audio
```text
AAC 256k (Format ID 141) ──[Jika Tidak Ada]──► Native Opus 48kHz (~160k) ──► Native AAC 128k ──► Best Audio
```
Selector format `yt-dlp` dikonfigurasi sebagai:
```bash
-f "ba[format_id=141]/ba[ext=m4a]/ba/b"
```
Jika sebuah video YouTube reguler tidak menyediakan format AAC 256k, sistem tidak akan error, melainkan otomatis mengunduh stream Opus kualitas tertinggi yang tersedia.

### Lapis 2: Fallback Autentikasi Cookies
Di Linux, Google Chrome dapat mengunci file database cookies (`~/.config/google-chrome/`) saat browser sedang aktif membuka banyak tab.
* Worker akan mencoba eksekusi pertama menggunakan `--cookies-from-browser chrome`.
* Jika akses database terkunci atau gagal, worker mencatat log:
  `"[AUTH FALLBACK] Sesi chrome bermasalah/terkunci. Beralih otomatis ke Fallback Mode Publik..."`
* Unduhan segera diulang secara otomatis menggunakan mode publik tanpa menghentikan antrian.

---

## 8. Standar Audio QC & Metrik Soundsystem

Aplikasi ini menggunakan standar penyiaran internasional **EBU R128** dan filter **ITU-R BS.1770 True Peak**:

### 1. True Peak (dBTP) — *Paling Krusial untuk Panggung*
* **Apa itu?** Pengukuran puncak gelombang analog rekonstruksi setelah melewati konverter DAC (*Digital-to-Analog Converter*).
* **Bahaya Sample Peak vs True Peak:** File audio lossy (MP3/AAC/Opus) sering kali terlihat aman di software biasa (misal -0.1 dBFS), namun saat direkonstruksi oleh DAC sound system, gelombang analognya melonjak melebihi 0 dBFS (*inter-sample clipping*). Hal ini menyebabkan distorsi harmonik kasar pada driver tweeter/horn horn panggung besar.
* **Standar Evaluasi:**
  * $\le -1.0\text{ dBTP}$: **`READY FOR FOH`** (Headroom aman).
  * Antara $-1.0\text{ s/d } 0\text{ dBTP}$: **`TRIM PREAMP (-2dB)`** (Perlu penurunan fader gain).
  * $> 0.0\text{ dBTP}$: **`CLIPPING HAZARD`** (Risiko distorsi inter-sample DAC).

### 2. Integrated Loudness (LUFS)
* Pengukuran persepsi kenyaringan rata-rata dari awal hingga akhir trek.
* Membantu operator menyeimbangkan volume antar lagu tanpa perlu kompresi berlebihan yang merusak dinamika.

### 3. Loudness Range (LRA / LU)
* Rentang dinamika audio. Angka LRA tinggi menunjukkan trek yang sangat dinamis (misal rekaman akustik/orkestra), sementara LRA rendah menunjukkan trek yang terkompresi rapat (*loudness war*).

---

## 9. Dokumentasi REST API Internal

Server lokal `web_ui.py` menyediakan endpoint RESTful JSON:

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/system` | Memeriksa ketersediaan binary sistem (`python`, `yt_dlp`, `ffmpeg`, `ffprobe`). |
| `GET` | `/api/queue` | Mengambil status tugas aktif, persentase progress, live logs, dan antrian. |
| `GET` | `/api/library` | Mengambil daftar seluruh file audio di `library/inbox/` secara rekursif beserta data QC. |
| `POST` | `/api/download` | Menambahkan daftar URL ke antrian unduhan. Menerima JSON payload: `urls`, `audio_format`, `is_playlist`, `use_cookies`, `cookie_browser`, `auto_scan`. |
| `POST` | `/api/scan` | Menjalankan audit QC menyeluruh secara manual ke seluruh file di `library/inbox/`. |

---

## 10. Troubleshooting & FAQ

#### Q: Mengapa muncul peringatan "Database is locked" pada log Chrome?
**J:** Chrome di Linux mengunci file cookie saat proses tertentu berjalan. Sistem Audio Lab sudah dilengkapi **Smart Fallback** yang otomatis mendeteksi kondisi ini dan beralih mengunduh via mode publik. Untuk memastikan cookie Chrome terbaca 100%, Anda cukup menutup jendela Chrome sebentar atau memastikan profil default tidak terkunci.

#### Q: Di mana letak file yang sudah diunduh?
**J:** Semua file tersimpan di dalam direktori `library/inbox/`. Jika diunduh sebagai playlist, file tersimpan di dalam folder sesuai nama playlistnya: `library/inbox/<Nama Playlist>/`.

#### Q: Apakah file audio yang sudah pernah diunduh akan terunduh lagi jika link playlist dimasukkan ulang?
**J:** Tidak. Sistem menggunakan arsip `library/downloaded_ids.txt`. Jika ID lagu sudah tercatat pernah berhasil diunduh, `yt-dlp` akan melewatinya (*skip*) secara otomatis untuk menghemat bandwidth dan waktu.

#### Q: Mengapa file MP3 hasil konversi dari Opus tidak terdengar lebih bagus dari aslinya?
**J:** Mengonversi audio lossy (Opus) ke format lossy lain (MP3) justru menyebabkan *generation loss* (penurunan mutu akibat proses kompresi ulang). Oleh sebab itu, selalu gunakan opsi **PREMIUM AAC 256k** atau **NATIVE OPUS 48kHz** untuk mempertahankan kualitas suara asli.
