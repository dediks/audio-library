# SWARARIA AUDIO LAB — Dokumentasi Lengkap Sistem, DSP & Audio QC Engine

Selamat datang di dokumentasi resmi **SWARARIA AUDIO LAB (Pro Audio Ingestion, Soundsystem QC, SoXR Converter & Tag Organizer)**. Dokumen ini dirancang sebagai panduan komprehensif bagi **Audio Engineer**, **Operator FOH / Soundsystem**, **DJ**, dan **Programmer**.

---

## Daftar Isi

1. [Ikhtisar Proyek & Filosofi Desain](#1-ikhtisar-proyek--filosofi-desain)
2. [Arsitektur 4 Halaman Dedicated (Pipeline Workstation)](#2-arsitektur-4-halaman-dedicated-pipeline-workstation)
3. [Tiga Fitur High-Value Pro Audio / FOH](#3-tiga-fitur-high-value-pro-audio--foh)
4. [Struktur Direktori & Modul](#4-struktur-direktori--modul)
5. [Prasyarat, Instalasi & Packaging Desktop App](#5-prasyarat-instalasi--packaging-desktop-app)
6. [Panduan Alur Kerja Web UI (Stage 1 s/d Stage 4)](#6-panduan-alur-kerja-web-ui-stage-1-sd-stage-4)
7. [Panduan Penggunaan CLI (`audio_manager.py`)](#7-panduan-penggunaan-cli-audio_managerpy)
8. [Standar Audio QC & Metrik Soundsystem (EBU R128 & Spektrum)](#8-standar-audio-qc--metrik-soundsystem-ebu-r128--spektrum)
9. [Dokumentasi REST API Internal](#9-dokumentasi-rest-api-internal)
10. [Sistem Pembaruan Otomatis (In-App GitHub Release Auto-Updater)](#10-sistem-pembaruan-otomatis-in-app-github-release-auto-updater)
11. [Keamanan Aplikasi (Secure Coding Standards)](#11-keamanan-aplikasi-secure-coding-standards)
12. [Troubleshooting & FAQ](#12-troubleshooting--faq)

---

## 1. Ikhtisar Proyek & Filosofi Desain

**SWARARIA AUDIO LAB** dibangun untuk menjawab kebutuhan nyata di lapangan panggung (_Live Sound / FOH_) dan manajemen pustaka audio:

1. **Fidelitas Ingestion:** Mengambil materi audio berizin dengan kualitas setinggi mungkin tanpa generasi kompresi berulang (_zero generation loss_ pada mode Native `.opus` / `.m4a`).
2. **Kesiapan Soundsystem Panggung (FOH QC):** Mengaudit sinyal audio secara objektif sebelum diputar di _sound system_ skala besar untuk mencegah distorsi _inter-sample_ DAC, lonjakan dinamika berbahaya, kliping amplifier, serta mendeteksi file **MP3 320 kbps palsu** (_upsampled_).
3. **Konsistensi Loudness & Kompatibilitas Perangkat:** Meratakan kekerasan suara antar lagu ke standar **$-14\text{ LUFS}$** dengan _True Peak Limiter_ **$-1.5\text{ dBTP}$**, serta mengonversi _sample rate_ menggunakan mesin **SoXR 28-bit VHQ** untuk CDJ/USB ($44.1\text{ kHz}$) atau Digital Mixer ($48.0\text{ kHz}$).
4. **Kerapian Katalog & Layar CDJ/Mixer:** Memberi nomor urut track otomatis (`01 - `, `02 - `) dan membersihkan tag sampah dari nama file secara massal.

### Prinsip Utama:

- **Zero Framework Overhead:** Backend berjalan di atas Python murni (`http.server`, `threading`, `subprocess`), memanfaatkan `ffmpeg`, `ffprobe`, dan `yt-dlp`.
- **UI/UX shadcn Dark High-Contrast:** Antarmuka bertema _Zinc/Black_ kontras tinggi yang nyaman dibaca di booth FOH/panggung yang gelap.
- **Non-Destruktif secara Default:** Proses konversi dan normalisasi secara default membuat folder baru otomatis (`[Nama Playlist] [44.1kHz]` atau `[Nama Playlist] [-14LUFS]`) sehingga file master asli tetap utuh.

---

## 2. Arsitektur 4 Halaman Dedicated (Pipeline Workstation)

Untuk menghindari penumpukan tombol dan kebingungan kognitif (_cognitive overload_), antarmuka dibagi menjadi **4 Halaman Dedicated** sesuai urutan kerja audio engineer. Keempat halaman ini terhubung melalui **Shared Workspace State** (`sessionStorage` via `getSharedWorkspaceState()` & `saveSharedWorkspaceState()`), sehingga folder sumber, playlist aktif, dan lagu yang dicentang tetap tersimpan saat berpindah tab:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                        SWARARIA AUDIO LAB WORKSTATION                      │
│               Shared Workspace State (Source, Playlist, Selection)         │
├──────────────────┬──────────────────┬──────────────────┬───────────────────┤
│   1. Ingest      │ 2. QC & Spectral │  3. Converter &  │  4. Tag & File    │
│      ( / )       │    Lab ( /qc )   │    Loudness      │     Organizer     │
│                  │                  │  ( /converter )  │   ( /organizer )  │
├──────────────────┼──────────────────┼──────────────────┼───────────────────┤
│ • Input Batch    │ • 4 Kartu KPI    │ • Konversi MP3   │ • Studio Auto-    │
│   URL / Playlist │   Diagnostik FOH │   (SoXR 28-bit)  │   Numbering       │
│ • Profil Native  │ • Cek Spektrum   │ • Lossless Remux │   (01 - , 001 - ) │
│   .opus / MP3    │   20kHz vs <16k  │   (.webm→.opus)  │ • Pembersih Tag   │
│ • Live Stream    │ • Audit EBU R128 │ • Normalisasi    │   Sampah YouTube  │
│   Terminal       │   (LUFS & dBTP)  │   -14 / -16 LUFS │ • Grouping Tipe   │
│ • Pipeline Hub   │ • Kirim Trek     │   + Limiter      │   File & Batch    │
│   Shortcuts      │   Merah ke Stg 3 │   -1.5 dBTP      │   Delete          │
└──────────────────┴──────────────────┴──────────────────┴───────────────────┘
```

---

## 3. Tiga Fitur High-Value Pro Audio / FOH

### A. Auto Loudness Normalization & True Peak Limiter (`EBU R128`)

- **Masalah di Lapangan:** Saat memutar playlist dari berbagai sumber di acara pernikahan/konser, lagu pertama bisa sangat pelan ($-18\text{ LUFS}$) sedangkan lagu berikutnya tiba-tiba meledak keras ($-6\text{ LUFS}$ dan kliping di $+1.2\text{ dBTP}$), memaksa operator terus-menerus menjaga fader.
- **Solusi (`audio_manager.py` $\rightarrow$ `normalize_one()` & `resample_one()`):**
  Menggunakan filter FFmpeg `loudnorm=I=-14:TP=-1.5:LRA=11` yang dikombinasikan dengan resampler **SoXR 28-bit**. Seluruh lagu memiliki rata-rata kekerasan yang seragam (**$-14\text{ LUFS}$** atau **$-16\text{ LUFS}$**) dan puncak gelombang analognya dikunci rapat di bawah **$-1.5\text{ dBTP}$**.

### B. Fake Bitrate / Spectral Quality Detector (`Anti-Fake 320 kbps`)

- **Masalah di Lapangan:** Banyak file audio di internet memiliki metadata `MP3 320 kbps` (atau `FLAC`/`WAV`), tetapi sebenarnya berasal dari sumber berkualitas rendah ($128\text{ kbps}$) yang di-_upsample_. Saat diputar di _line array_ panggung besar, suara _high-hat_ terdengar tipis, kasar (_phasiness_), dan mendem.
- **Solusi (`audio_manager.py` $\rightarrow$ `analyze_spectral_quality()`):**
  Mengukur energi RMS pada pita referensi tengah ($1\text{ kHz}$) dibandingkan dengan pita frekuensi tinggi ($16\text{ kHz}$ dan $20\text{ kHz}$) pada segmen puncak lagu:
  - **`AUTHENTIC_HQ` (`✨ 20kHz Asli`)**: Energi di atas $19.5\text{ kHz}$ terdeteksi utuh.
  - **`STANDARD_LOSSY` (`✓ 16kHz Full`)**: Spektrum normal hingga $16\text{ kHz}$–$18\text{ kHz}$.
  - **`FAKE_HQ` (`⚠️ Spektrum <16k (Upsampled)`)**: Bitrate diklaim tinggi ($\ge 220\text{ kbps}$) atau _lossless_, tetapi frekuensi di atas $16\text{ kHz}$ terpotong habis (_brickwall cutoff_).

### C. Batch Auto-Numbering & YouTube Tag Cleaner Studio

- **Masalah di Lapangan:** File hasil unduhan sering memiliki nama panjang yang mengacaukan urutan abjad di layar CDJ/Mixer dan dipenuhi tag sampah seperti `Lagu Pop (Official Music Video) [HD] [dQw4w9WgXcQ].mp3`.
- **Solusi (`fs_browser.py` $\rightarrow$ `clean_and_number_filename()` & `batch_rename_entries()`):**
  - Menghapus ID YouTube 11 karakter di akhir judul (`[dQw4w9WgXcQ]`).
  - Menghapus tag tidak relevan (`(Official Music Video)`, `[Official Audio]`, `(Lyrics)`, `(Lirik)`, `[HD]`, `[4K]`, `(Visualizer)`, `[MV]`, termasuk yang dipisahkan oleh karakter pipa `｜` atau `|`).
  - Mengubah garis bawah (`_`) dan karakter pipa menjadi pemisah bersih, lalu memberi nomor urut track otomatis (`01 - `, `001 - `, atau `01. `) lengkap dengan **Live Diff Preview** sebelum diterapkan ke disk.

---

## 4. Struktur Direktori & Modul

```text
audio-library-starter/
├── desktop_app.py            # Launcher aplikasi desktop mandiri (pywebview Native Window + App-Mode fallback)
├── build_desktop.py          # Script builder otomatis desktop app + Inno Setup compiler (--installer)
├── build_installer.bat       # 1-Click Builder Windows Setup Wizard (.exe) dari nol hingga jadi
├── SwarariaAudioLab.spec     # Konfigurasi bundling PyInstaller (menyertakan static/, yt-dlp, & FFmpeg)
├── installer.iss             # Konfigurasi Inno Setup untuk membuat installer Windows (SwarariaAudioLab_Setup.exe)
├── run.bat                   # 1-Click Runner Script untuk Windows (Auto .venv, pip, verify FFmpeg & launch Desktop)
├── run.sh                    # 1-Command Runner Script untuk Linux & macOS (Auto .venv, pip, verify FFmpeg & launch)
├── requirements.txt          # Spesifikasi dependensi Python resmi (yt-dlp & pywebview)
├── audio_manager.py          # Engine inti FFmpeg: QC EBU R128, Spectral Analyzer, SoXR Resampler, Normalizer, & CLI
├── task_engine.py            # Worker antrian FIFO latar belakang, caching metadata/QC, & orkestrasi batch
├── fs_browser.py             # Operasi filesystem aman: rename, batch auto-number/clean, delete, & directory picker
├── splitter_engine.py        # Engine pemotong multitrack WAV / video konser losslessly
├── web_ui.py                 # Server HTTP lokal (127.0.0.1:8765) & routing 4 halaman + REST API + Auto-Update
├── README.md                 # Panduan ringkas proyek
├── DOCUMENTATION.md          # Dokumentasi teknis lengkap (file ini)
├── tests/
│   ├── run_tests.py          # Minimal test runner
│   ├── test_ingest.py        # Unit test ingest & selector yt-dlp
│   ├── test_organizer.py     # Unit test auto-numbering & tag cleaner
│   └── test_update_checker.py # Unit test semver parsing & GitHub update checker
├── library/
│   ├── downloaded_ids.txt    # Arsip ID lagu untuk mencegah unduhan duplikat
│   └── inbox/                # Direktori default koleksi audio (mendukung subfolder playlist)
└── static/
    ├── index.html            # Stage 1: Batch Audio Ingestion UI
    ├── app.js                # Logika Stage 1 (Ingest form, Queue monitor, Pipeline Hub)
    ├── qc.html               # Stage 2: Soundsystem QC & Spectral Lab UI
    ├── qc.js                 # Logika Stage 2 (4 KPI Cards, Spectral Probe, Full EBU R128 Audit)
    ├── converter.html        # Stage 3: Sample Rate Converter & EBU R128 Loudness UI
    ├── converter.js          # Logika Stage 3 (SoXR MP3, Lossless Remux .opus, Normalizer -14/-16 LUFS)
    ├── organizer.html        # Stage 4: Tag & File Organizer Studio UI
    ├── organizer.js          # Logika Stage 4 (Live Diff Preview, Auto-Numbering, Grouping Tipe, Batch Delete)
    ├── style.css             # Sistem desain utama (shadcn/ui Dark High-Contrast Zinc/Black)
    ├── converter.css         # Komponen kompak khusus kontrol segmen, tabel grup, & toolbar
    ├── swararia-logo.jpg     # Aset logo resmi SWARARIA AUDIO LAB
    └── modules/
        ├── ui-shared.js      # Header 4-tahap, Shared Workspace State, Spectral Badge, & API helpers
        ├── table-groups.js   # Engine pengelompokan tabel (Folder, Tipe File, Folder+Tipe, Sample Rate)
        ├── rename-modal.js   # Modal rename tunggal, konfirmasi hapus, & batch rename
        ├── folder-modal.js   # Browser direktori interaktif (mendukung pemilihan Drive / USB)
        ├── queue-monitor.js  # Poller status antrian & stream log real-time
        ├── notifications.js  # Toast notifikasi & pusat riwayat notifikasi + sintesis Web Audio
        └── dom-icons.js      # Pembuat ikon SVG murni via createElementNS (bebas innerHTML)
```

---

## 5. Prasyarat, Instalasi & Packaging Desktop App

### A. Menjalankan Langsung dari Source Code (1-Klik)

Proyek ini telah dilengkapi dengan script inisialisasi cerdas yang secara otomatis mengisolasi environment Python (`.venv`), memasang dependensi dari `requirements.txt`, memvalidasi FFmpeg, dan meluncurkan jendela **Desktop App**:

- **Di Windows:**
  Cukup klik ganda **`run.bat`** di File Explorer, atau ketik di Command Prompt/PowerShell:
  ```cmd
  run.bat
  ```
- **Di Linux / macOS:**
  Jalankan script bash di terminal:
  ```bash
  ./run.sh          # Meluncurkan Desktop App Window
  ./run.sh --web    # Meluncurkan mode Web Server saja (127.0.0.1:8765)
  ```

### B. Membuat Installer Ala Wizard Windows (`SwarariaAudioLab_Setup.exe`) untuk Orang Awam

Agar pengguna akhir (Sound Engineer, DJ, Event Organizer) dapat menginstal aplikasi seperti aplikasi profesional umumnya (*Next $\rightarrow$ Next $\rightarrow$ Install $\rightarrow$ Finish*) **tanpa perlu menginstall Python maupun FFmpeg**:

#### 1. Prasyarat Sistem Windows (Hanya saat mem-build):
- **Python 3.10+** (pastikan centang *"Add python.exe to PATH"* saat instalasi).
- **Inno Setup 6** (Compiler installer Windows resmi):
  ```cmd
  winget install JRSoftware.InnoSetup
  ```

> **Catatan untuk Pengguna WSL:**
> PyInstaller **tidak mendukung cross-compilation** (PyInstaller di Linux menghasilkan binary Linux ELF, bukan file `.exe` Windows). Jika kode berada di dalam WSL, buka folder WSL dari Windows PowerShell menggunakan path `\\wsl.localhost\Ubuntu\home\dedik\project\audio-library-starter` lalu jalankan proses build menggunakan **Python Windows**.

#### 2. Cara 1-Klik di Windows (Rekomendasi):
Cukup klik ganda file **`build_installer.bat`**. Script ini akan secara otomatis:
- Memeriksa instalasi Python dan Inno Setup.
- Mengunduh dependensi build (`pyinstaller` & `pywebview`).
- Mengemas seluruh aplikasi ke `dist/SwarariaAudioLab/`.
- Memanggil compiler Inno Setup (`ISCC.exe`) untuk menghasilkan **`dist\SwarariaAudioLab_Setup.exe`**.
- Membuka folder `dist` di Windows Explorer secara otomatis saat selesai.

#### 3. Cara Command Line:
```bash
# Build desktop app + kompilasi Setup Wizard otomatis:
python build_desktop.py --install-deps --installer

# Opsi pembersihan cache sebelum build (rekomendasi pasca update kode):
python build_desktop.py --clean --installer
```

#### 4. Opsi Distribusi:
- **Installer Wizard (`dist\SwarariaAudioLab_Setup.exe`)**: File setup tunggal (~160 MB). Otomatis membuat shortcut Desktop & Start Menu, izin folder pustaka aman, dan registrasi Uninstaller di *Windows Settings*.
- **Portable Folder (`dist\SwarariaAudioLab\`)**: Bisa langsung dikompres ke `.zip` untuk dijalankan tanpa instalasi.

### C. Menjalankan Manual (Mode Developer)

```bash
# 1. Pasang dependensi
pip install -r requirements.txt

# 2. Jalankan Desktop App ATAU Web Server
python3 desktop_app.py   # Jendela Desktop Mandiri
python3 web_ui.py        # Web Server Lokal (http://127.0.0.1:8765)
```

---

## 6. Panduan Alur Kerja Web UI (Stage 1 s/d Stage 4)

Jalankan server:

```bash
python3 web_ui.py
```

Buka browser di **`http://127.0.0.1:8765`**.

### Tahap 1: `1. Ingest` (`/`)

1. **Pencarian Langsung (In-App Search)** atau **Input URL Manual**:
   - **Pencarian YouTube Music**: Ketik judul lagu, musisi, atau playlist di bar pencarian di bagian atas form, pilih tab filter (`🎵 Lagu`, `📁 Playlist`, `💿 Album`, `🌐 Semua`), lalu tekan Enter atau klik **Cari Musik**.
     - Klik **`+ Ke Antrean`** untuk memasukkan URL ke kotak antrean.
     - Centang beberapa item lalu klik **`+ Masukkan Terpilih`** untuk antrean massal.
     - Klik **`⚡ Unduh`** untuk langsung mengunduh trek terpilih dalam 1-klik.
   - **Input Manual**: Atau tempelkan satu atau beberapa URL/Playlist langsung pada kotak textarea input (satu URL per baris).
2. Pilih **Mode Format**:
   - **Native Audio (`.opus` / `.m4a`)**: Tanpa _re-encoding_, mempertahankan kualitas sumber 100%.
   - **MP3 CBR (`320` / `192` / `128` / `96 kbps`)**: Langsung menghasilkan file `.mp3` siap putar.
3. Klik **Mulai Ekstraksi Batch** dan pantau progres di _Queue & Extraction Monitor_.

### Tahap 2: `2. QC & Spectral Lab` (`/qc`)

1. Perhatikan **4 Kartu KPI Diagnostik** di bagian atas halaman.
2. Klik **Cek Cepat Spektrum** untuk memindai codec, sample rate, dan mendeteksi apakah ada file _Fake HQ / Upsampled_ (`<16 kHz`).
3. Klik **Jalankan Full QC Audit** untuk menghitung nilai **True Peak ($\text{dBTP}$)**, **Integrated Loudness ($\text{LUFS}$)**, dan **LRA ($\text{LU}$)**.
4. Klik tombol **`Pilih Bermasalah`** untuk mencentang semua lagu yang berstatus `CLIPPING HAZARD` atau `TRIM PREAMP`, lalu klik **`🎚️ Normalisasi Terpilih →`** untuk mengirimnya langsung ke Tahap 3.

### Tahap 3: `3. Converter & Loudness` (`/converter`)

1. Pilih **Mode Proses Audio**:
   - **Konversi ke MP3 (SoXR)**: Pilih sample rate ($44.1\text{ kHz}$ / $48.0\text{ kHz}$), bitrate ($320\text{k}$–$96\text{k}$), dan opsional aktifkan **Normalisasi $-14\text{ LUFS}$ / $-16\text{ LUFS}$**.
   - **Lossless Remux (`.opus`)**: Mengubah file `.webm` menjadi `.opus` secara instan tanpa _re-encode_.
   - **Normalisasi EBU R128**: Meratakan kekerasan lagu dan memasang limiter anti-kliping ($-1.5\text{ dBTP}$) dengan mempertahankan format/sample rate asli.
2. Pilih **Lokasi Penyimpanan Output** (_Folder Baru Otomatis_, _Timpa Asli_, atau _Folder Lain / USB_).
3. Klik **`Konversi / Normalisasi Terpilih`**.

### Tahap 4: `4. Tag & File Organizer` (`/organizer`)

1. Centang lagu atau satu folder playlist penuh di tabel bawah.
2. Di panel kiri atas (**Auto-Numbering & Pembersih Tag**), pilih format nomor urut (`01 - Judul`, `001 - Judul`, `01. Judul`, atau `Tanpa Nomor Urut`) dan centang aturan pembersihan tag sampah YouTube.
3. Periksa simulasi perubahan nama secara langsung di panel kanan (**Live Preview Perubahan Nama**) maupun pada kolom **Simulasi Nama Baru** di tabel.
4. Klik **`Terapkan Rename`** untuk merapikan seluruh file sekaligus.
5. Untuk menghapus file mentah (misal `.opus`/`.webm` setelah dikonversi ke `.mp3`), ubah dropdown grup menjadi **`Grup: 🎵 Tipe File (.opus/.webm/.mp3)`** atau klik tombol **`Pilih Non-MP3 (.opus/.webm)`**, lalu klik **`Hapus Terpilih`**.

---

## 7. Panduan Penggunaan CLI (`audio_manager.py`)

Selain melalui Web UI, Anda dapat menjalankan fungsi inti melalui terminal:

```bash
# 1. Cari musik/playlist di YouTube Music langsung dari CLI:
python3 audio_manager.py search "Sheila on 7" --type songs --limit 10

# 2. Audit QC folder audio lokal & ekspor laporan CSV:
python3 audio_manager.py scan "/path/ke/folder/audio" --out quality_report.csv

# 3. Unduh Native Audio (Opus 48kHz / AAC) + QC:
python3 audio_manager.py download "URL_TRACK_ATAU_PLAYLIST" --authorized --playlist --scan

# 4. Unduh langsung ke MP3 CBR 320 kbps:
python3 audio_manager.py download "URL_TRACK" --authorized --format mp3 --bitrate 320 --scan
```

---

## 8. Standar Audio QC & Metrik Soundsystem (EBU R128 & Spektrum)

| Metrik                                  | Standar Aman FOH                 | Peringatan (Trim)                 | Bahaya (Clipping / Palsu)          | Penjelasan Teknis                                                                                                                    |
| :-------------------------------------- | :------------------------------- | :-------------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| **True Peak ($\text{dBTP}$)**           | $\le -1.0\text{ dBTP}$           | $-1.0\text{ s/d }0.0\text{ dBTP}$ | $> 0.0\text{ dBTP}$                | Puncak gelombang analog pasca-rekonstruksi DAC. Nilai $> 0\text{ dBTP}$ memicu _inter-sample clipping_ pada tweeter/driver panggung. |
| **Integrated Loudness ($\text{LUFS}$)** | $-14\text{ s/d }-16\text{ LUFS}$ | $-9\text{ s/d }-13\text{ LUFS}$   | $> -8\text{ LUFS}$                 | Kekerasan rata-rata lagu menurut standar EBU R128.                                                                                   |
| **Loudness Range ($\text{LRA}$)**       | $5\text{ s/d }12\text{ LU}$      | $< 4\text{ LU}$ (Kompresi padat)  | $> 18\text{ LU}$ (Terlalu dinamis) | Rentang dinamika antara bagian pelan dan keras dalam satu lagu.                                                                      |
| **Spektrum Frekuensi**                  | `✨ 20kHz Asli` / `✓ 16kHz Full` | `Spektrum <15k` (Bitrate rendah)  | `⚠️ Spektrum <16k (Upsampled)`     | Rasio energi frekuensi tinggi untuk mendeteksi file _transcode_ palsu.                                                               |

---

## 9. Dokumentasi REST API Internal

Server lokal [`web_ui.py`](file:///home/dedik/project/audio-library-starter/web_ui.py) menyediakan rute halaman HTML dan endpoint JSON RESTful:

### Rute Halaman HTML (`GET`)

- `GET /` atau `/index.html` $\rightarrow$ Stage 1: **Batch Audio Ingestion**
- `GET /qc` atau `/qc.html` $\rightarrow$ Stage 2: **Soundsystem QC & Spectral Lab**
- `GET /converter` atau `/converter.html` $\rightarrow$ Stage 3: **Converter & Loudness**
- `GET /organizer` atau `/organizer.html` $\rightarrow$ Stage 4: **Tag & File Organizer**

### Rute REST API (`/api/*`)

| Method | Endpoint                | Deskripsi                                                                                                                                                                                                                   |
| :----- | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/system`           | Memeriksa status ketersediaan binary (`python`, `yt_dlp`, `ffmpeg`, `ffprobe`, `app_version`).                                                                                                                              |
| `GET`  | `/api/queue`            | Mengambil status tugas aktif, persentase progress, _live logs_, dan riwayat antrian.                                                                                                                                        |
| `GET`  | `/api/library`          | Mengambil daftar file audio, ringkasan folder playlist, dan cache QC (mendukung query `?source_dir=...`).                                                                                                                   |
| `GET`  | `/api/fs/list`          | Menjelajahi daftar direktori lokal & shortcut drive/USB untuk modal pemilih folder (`?path=...`).                                                                                                                           |
| `GET`  | `/api/check-update`     | Memeriksa rilis terbaru di GitHub Releases (`dediks/audio-library`), membandingkan semver `APP_VERSION`, dan mengekstrak aset `.exe`.                                                                                       |
| `POST` | `/api/install-update`   | Mengunduh paket installer resmi dan meluncurkan installer untuk pembaruan in-place otomatis (`download_url`).                                                                                                               |
| `POST` | `/api/fs/mkdir`         | Membuat subfolder baru di dalam direktori tujuan (`parent_dir`, `name`).                                                                                                                                                    |
| `POST` | `/api/fs/open-explorer` | Membuka folder sumber/playlist di File Manager sistem operasi (`source_dir`, `rel_path`).                                                                                                                                   |
| `POST` | `/api/search`           | Mencari lagu, playlist, atau album di YouTube Music (`query`, `type`, `limit`, `use_cookies`). Mengembalikan metadata, thumbnail, durasi, dan URL siap unduh.                                                             |
| `POST` | `/api/download`         | Menjadwalkan tugas Batch Ingestion (`urls`, `audio_format`, `audio_bitrate`, `is_playlist`, `use_cookies`, `auto_scan`).                                                                                                    |
| `POST` | `/api/scan`             | Menjadwalkan audit penuh EBU R128 + Spektrum (`source_dir`).                                                                                                                                                                |
| `POST` | `/api/probe`            | Memindai cepat metadata `ffprobe` + keaslian spektrum frekuensi (`source_dir`, `folder`, `probe_spectral`).                                                                                                                 |
| `POST` | `/api/resample`         | Menjadwalkan konversi SoXR MP3, Lossless Remux `.opus`, atau Normalisasi EBU R128 (`mode`, `source_dir`, `dest_dir`, `rel_paths`, `target_rate`, `target_bitrate`, `normalize_lufs`, `overwrite`).                          |
| `POST` | `/api/rename`           | Mengubah nama satu file audio atau satu folder playlist (`source_dir`, `rel_path`, `new_name`, `is_folder`).                                                                                                                |
| `POST` | `/api/batch-rename`     | Simulasi preview (`preview: true`) atau eksekusi (`preview: false`) Auto-Numbering & Pembersih Tag YouTube (`source_dir`, `rel_paths`, `numbering_mode`, `start_number`, `strip_yt_id`, `strip_junk_tags`, `clean_spaces`). |
| `POST` | `/api/delete`           | Menghapus satu file, satu folder playlist, atau _batch delete_ banyak file sekaligus (`source_dir`, `rel_path` / `rel_paths`, `is_folder`).                                                                                 |

---

## 10. Sistem Pembaruan Otomatis (In-App GitHub Release Auto-Updater)

Aplikasi telah dilengkapi subsistem pembaruan mandiri terintegrasi dengan GitHub Releases repository [dediks/audio-library](https://github.com/dediks/audio-library):

### A. Alur Kerja Pengguna Akhir (User Experience)
1. **Status Pill Interaktif**: Pada header pojok kanan atas, terdapat pill versi aplikasi (contoh `Ver: v1.0.0`).
2. **Background Polling**: Saat aplikasi dibuka, thread latar belakang mengecek GitHub API `GET /repos/dediks/audio-library/releases/latest`.
3. **Indikator Update**: Jika versi rilis lebih tinggi dari versi yang sedang berjalan:
   - Badge berubah menjadi warna hijau menyala (`v1.0.1 ⚡`).
   - Notifikasi mengambang muncul memberitahukan tersedianya pembaruan.
4. **Dialog Changelog & 1-Click Update**:
   - Pengguna mengklik badge versi untuk membuka modal interaktif.
   - Modal menampilkan perbandingan versi, tanggal rilis, dan **Catatan Rilis (Changelog)** asli dari GitHub.
   - Pengguna cukup menekan tombol **`⚡ Unduh & Pasang Pembaruan`**. Sistem akan mengunduh file `.exe` ke folder temporary, menjalankan installer wizard, dan menutup aplikasi lama untuk proses pembaruan otomatis tanpa menghapus data musik pengguna.

### B. Alur Kerja Rilis Pengembang (Developer Release Flow)
Setiap kali ada perbaikan bug atau penambahan fitur:
1. **Perbarui Nomor Versi**:
   - `web_ui.py`: Ubah `APP_VERSION = "1.0.1"`
   - `installer.iss`: Ubah `#define MyAppVersion "1.0.1"`
2. **Rebuild Installer Windows**:
   ```cmd
   python build_desktop.py --clean --installer
   ```
   *(Atau jalankan `build_installer.bat`)*.
3. **Terbitkan Rilis di GitHub**:
   - Buka `https://github.com/dediks/audio-library/releases/new`.
   - Masukkan Tag (contoh: `v1.0.1`), judul rilis, dan ringkasan pembaruan.
   - Unggah (*Attach*) berkas **`dist/SwarariaAudioLab_Setup.exe`**.
   - Klik **Publish release**. Seluruh instalasi pengguna akan otomatis mendeteksi rilis baru ini.

---

## 11. Keamanan Aplikasi (Secure Coding Standards)

1. **Strict Localhost Binding:** Server HTTP diikat secara eksklusif ke `127.0.0.1:8765` dan tidak membuka port ke jaringan publik (`0.0.0.0`).
2. **Zero DOM XSS:** Seluruh kode JavaScript di `static/` menggunakan `document.createElement()`, `document.createElementNS()`, dan `textContent`. Tidak ada penggunaan `innerHTML`, `outerHTML`, `insertAdjacentHTML`, atau `document.write`.
3. **Strict Path Boundary Validation:** Semua operasi baca/ubah/hapus di [`fs_browser.py`](file:///home/dedik/project/audio-library-starter/fs_browser.py) meresolusi path absolut (`Path.resolve()`) dan memverifikasi bahwa target berada tepat di bawah direktori sumber yang diizinkan (mencegah _Path Traversal_ `../`).
4. **Safe Subprocess Execution:** Pemanggilan `ffmpeg`, `ffprobe`, dan `yt-dlp` selalu menggunakan array argumen terstruktur tanpa `shell=True`.
5. **Verified Release Sinks:** Endpoint `/api/install-update` hanya menerima permintaan dari klien localhost dan memvalidasi awalan URL unduhan terhadap allow-list domain rilis resmi GitHub (`https://github.com/dediks/audio-library/releases/download/`).

---

## 12. Troubleshooting & FAQ

#### Q: Mengapa muncul peringatan "Database is locked" pada log Chrome?

**J:** Chrome di Linux mengunci file cookie saat browser sedang aktif. Sistem dilengkapi **Smart Fallback** yang otomatis beralih mengunduh via mode publik tanpa menghentikan antrian.

#### Q: Apakah memilih lagu di halaman QC akan hilang saat saya pindah ke halaman Converter atau Organizer?

**J:** Tidak. Aplikasi menggunakan **Shared Workspace State** (`sessionStorage`) yang menyimpan folder sumber aktif, filter playlist, dan daftar lagu yang dicentang saat Anda berpindah antar-halaman.

#### Q: Bagaimana cara menghapus semua file `.opus`/`.webm` setelah saya mengonversinya ke `.mp3`?

**J:** Buka halaman **`4. Tag & File Organizer`** (`/organizer`), klik tombol **`Pilih Non-MP3 (.opus/.webm)`** di kanan atas tabel (atau kelompokkan tabel dengan **`Grup: 🎵 Tipe File`**), lalu klik **`Hapus Terpilih`**.

#### Q: Apakah file audio yang sudah diunduh di `library/inbox/` akan terhapus saat melakukan update versi baru?

**J:** Tidak. Installer Inno Setup (`installer.iss`) dirancang melakukan pembaruan secara *in-place*. File program binary diperbarui, namun direktori pustaka lagu `library/inbox/` tetap aman dan tidak tersentuh.

#### Q: Saya mengembangkan kode di dalam WSL (Ubuntu), bagaimana cara mem-build file `.exe` Windows?

**J:** Buka terminal PowerShell di Windows, masuk ke folder WSL via network path `cd \\wsl.localhost\Ubuntu\home\dedik\project\audio-library-starter`, lalu jalankan `python build_desktop.py --install-deps --installer` menggunakan Python Windows. PyInstaller membutuhkan environment Windows agar dapat menghasilkan file `.exe` Windows.
