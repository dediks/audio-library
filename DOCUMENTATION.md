# SWARARIA AUDIO LAB — Dokumentasi Lengkap Sistem, DSP & Audio QC Engine

Selamat datang di dokumentasi resmi **SWARARIA AUDIO LAB (Pro Audio Ingestion, Soundsystem QC, SoXR Converter & Tag Organizer)**. Dokumen ini dirancang sebagai panduan komprehensif bagi **Audio Engineer**, **Operator FOH / Soundsystem**, **DJ**, dan **Programmer**.

---

## Daftar Isi
1. [Ikhtisar Proyek & Filosofi Desain](#1-ikhtisar-proyek--filosofi-desain)
2. [Arsitektur 4 Halaman Dedicated (Pipeline Workstation)](#2-arsitektur-4-halaman-dedicated-pipeline-workstation)
3. [Tiga Fitur High-Value Pro Audio / FOH](#3-tiga-fitur-high-value-pro-audio--foh)
4. [Struktur Direktori & Modul](#4-struktur-direktori--modul)
5. [Prasyarat & Instalasi](#5-prasyarat--instalasi)
6. [Panduan Alur Kerja Web UI (Stage 1 s/d Stage 4)](#6-panduan-alur-kerja-web-ui-stage-1-sd-stage-4)
7. [Panduan Penggunaan CLI (`audio_manager.py`)](#7-panduan-penggunaan-cli-audio_managerpy)
8. [Standar Audio QC & Metrik Soundsystem (EBU R128 & Spektrum)](#8-standar-audio-qc--metrik-soundsystem-ebu-r128--spektrum)
9. [Dokumentasi REST API Internal](#9-dokumentasi-rest-api-internal)
10. [Keamanan Aplikasi (Secure Coding Standards)](#10-keamanan-aplikasi-secure-coding-standards)
11. [Troubleshooting & FAQ](#11-troubleshooting--faq)

---

## 1. Ikhtisar Proyek & Filosofi Desain

**SWARARIA AUDIO LAB** dibangun untuk menjawab kebutuhan nyata di lapangan panggung (*Live Sound / FOH*) dan manajemen pustaka audio:
1. **Fidelitas Ingestion:** Mengambil materi audio berizin dengan kualitas setinggi mungkin tanpa generasi kompresi berulang (*zero generation loss* pada mode Native `.opus` / `.m4a`).
2. **Kesiapan Soundsystem Panggung (FOH QC):** Mengaudit sinyal audio secara objektif sebelum diputar di *sound system* skala besar untuk mencegah distorsi *inter-sample* DAC, lonjakan dinamika berbahaya, kliping amplifier, serta mendeteksi file **MP3 320 kbps palsu** (*upsampled*).
3. **Konsistensi Loudness & Kompatibilitas Perangkat:** Meratakan kekerasan suara antar lagu ke standar **$-14\text{ LUFS}$** dengan *True Peak Limiter* **$-1.5\text{ dBTP}$**, serta mengonversi *sample rate* menggunakan mesin **SoXR 28-bit VHQ** untuk CDJ/USB ($44.1\text{ kHz}$) atau Digital Mixer ($48.0\text{ kHz}$).
4. **Kerapian Katalog & Layar CDJ/Mixer:** Memberi nomor urut track otomatis (`01 - `, `02 - `) dan membersihkan tag sampah dari nama file secara massal.

### Prinsip Utama:
* **Zero Framework Overhead:** Backend berjalan di atas Python murni (`http.server`, `threading`, `subprocess`), memanfaatkan `ffmpeg`, `ffprobe`, dan `yt-dlp`.
* **UI/UX shadcn Dark High-Contrast:** Antarmuka bertema *Zinc/Black* kontras tinggi yang nyaman dibaca di booth FOH/panggung yang gelap.
* **Non-Destruktif secara Default:** Proses konversi dan normalisasi secara default membuat folder baru otomatis (`[Nama Playlist] [44.1kHz]` atau `[Nama Playlist] [-14LUFS]`) sehingga file master asli tetap utuh.

---

## 2. Arsitektur 4 Halaman Dedicated (Pipeline Workstation)

Untuk menghindari penumpukan tombol dan kebingungan kognitif (*cognitive overload*), antarmuka dibagi menjadi **4 Halaman Dedicated** sesuai urutan kerja audio engineer. Keempat halaman ini terhubung melalui **Shared Workspace State** (`sessionStorage` via `getSharedWorkspaceState()` & `saveSharedWorkspaceState()`), sehingga folder sumber, playlist aktif, dan lagu yang dicentang tetap tersimpan saat berpindah tab:

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
* **Masalah di Lapangan:** Saat memutar playlist dari berbagai sumber di acara pernikahan/konser, lagu pertama bisa sangat pelan ($-18\text{ LUFS}$) sedangkan lagu berikutnya tiba-tiba meledak keras ($-6\text{ LUFS}$ dan kliping di $+1.2\text{ dBTP}$), memaksa operator terus-menerus menjaga fader.
* **Solusi (`audio_manager.py` $\rightarrow$ `normalize_one()` & `resample_one()`):**
  Menggunakan filter FFmpeg `loudnorm=I=-14:TP=-1.5:LRA=11` yang dikombinasikan dengan resampler **SoXR 28-bit**. Seluruh lagu memiliki rata-rata kekerasan yang seragam (**$-14\text{ LUFS}$** atau **$-16\text{ LUFS}$**) dan puncak gelombang analognya dikunci rapat di bawah **$-1.5\text{ dBTP}$**.

### B. Fake Bitrate / Spectral Quality Detector (`Anti-Fake 320 kbps`)
* **Masalah di Lapangan:** Banyak file audio di internet memiliki metadata `MP3 320 kbps` (atau `FLAC`/`WAV`), tetapi sebenarnya berasal dari sumber berkualitas rendah ($128\text{ kbps}$) yang di-*upsample*. Saat diputar di *line array* panggung besar, suara *high-hat* terdengar tipis, kasar (*phasiness*), dan mendem.
* **Solusi (`audio_manager.py` $\rightarrow$ `analyze_spectral_quality()`):**
  Mengukur energi RMS pada pita referensi tengah ($1\text{ kHz}$) dibandingkan dengan pita frekuensi tinggi ($16\text{ kHz}$ dan $20\text{ kHz}$) pada segmen puncak lagu:
  * **`AUTHENTIC_HQ` (`✨ 20kHz Asli`)**: Energi di atas $19.5\text{ kHz}$ terdeteksi utuh.
  * **`STANDARD_LOSSY` (`✓ 16kHz Full`)**: Spektrum normal hingga $16\text{ kHz}$–$18\text{ kHz}$.
  * **`FAKE_HQ` (`⚠️ Spektrum <16k (Upsampled)`)**: Bitrate diklaim tinggi ($\ge 220\text{ kbps}$) atau *lossless*, tetapi frekuensi di atas $16\text{ kHz}$ terpotong habis (*brickwall cutoff*).

### C. Batch Auto-Numbering & YouTube Tag Cleaner Studio
* **Masalah di Lapangan:** File hasil unduhan sering memiliki nama panjang yang mengacaukan urutan abjad di layar CDJ/Mixer dan dipenuhi tag sampah seperti `Lagu Pop (Official Music Video) [HD] [dQw4w9WgXcQ].mp3`.
* **Solusi (`fs_browser.py` $\rightarrow$ `clean_and_number_filename()` & `batch_rename_entries()`):**
  * Menghapus ID YouTube 11 karakter di akhir judul (`[dQw4w9WgXcQ]`).
  * Menghapus tag tidak relevan (`(Official Music Video)`, `[Official Audio]`, `(Lyrics)`, `(Lirik)`, `[HD]`, `[4K]`, `(Visualizer)`, `[MV]`, termasuk yang dipisahkan oleh karakter pipa `｜` atau `|`).
  * Mengubah garis bawah (`_`) dan karakter pipa menjadi pemisah bersih, lalu memberi nomor urut track otomatis (`01 - `, `001 - `, atau `01. `) lengkap dengan **Live Diff Preview** sebelum diterapkan ke disk.

---

## 4. Struktur Direktori & Modul

```text
audio-library-starter/
├── audio_manager.py          # Engine inti FFmpeg: QC EBU R128, Spectral Analyzer, SoXR Resampler, Normalizer, & CLI
├── task_engine.py            # Worker antrian FIFO latar belakang, caching metadata/QC, & orkestrasi batch
├── fs_browser.py             # Operasi filesystem aman: rename, batch auto-number/clean, delete, & directory picker
├── web_ui.py                 # Server HTTP lokal (127.0.0.1:8765) & routing 4 halaman + REST API
├── README.md                 # Panduan ringkas proyek
├── DOCUMENTATION.md          # Dokumentasi teknis lengkap (file ini)
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

## 5. Prasyarat & Instalasi

### Kebutuhan Perangkat Lunak
* **Sistem Operasi:** Linux (Ubuntu, Debian, Fedora, Arch, dsb.), Windows, atau macOS.
* **Python:** Versi 3.10 atau lebih baru.
* **FFmpeg & ffprobe:** Terpasang di `PATH` (dengan dukungan `libmp3lame`, `libopus`, `aresample=resampler=soxr`, dan filter `ebur128`/`loudnorm`).
* **yt-dlp:** CLI downloader versi terbaru.

### Verifikasi Instalasi
```bash
python3 --version
ffmpeg -version
ffprobe -version
yt-dlp --version
```

---

## 6. Panduan Alur Kerja Web UI (Stage 1 s/d Stage 4)

Jalankan server:
```bash
python3 web_ui.py
```
Buka browser di **`http://127.0.0.1:8765`**.

### Tahap 1: `1. Ingest` (`/`)
1. Tempelkan satu atau beberapa URL/Playlist pada kotak input.
2. Pilih **Mode Format**:
   * **Native Audio (`.opus` / `.m4a`)**: Tanpa *re-encoding*, mempertahankan kualitas sumber 100%.
   * **MP3 CBR (`320` / `192` / `128` / `96 kbps`)**: Langsung menghasilkan file `.mp3` siap putar.
3. Klik **Mulai Ekstraksi Batch** dan pantau progres di *Queue & Extraction Monitor*.

### Tahap 2: `2. QC & Spectral Lab` (`/qc`)
1. Perhatikan **4 Kartu KPI Diagnostik** di bagian atas halaman.
2. Klik **Cek Cepat Spektrum** untuk memindai codec, sample rate, dan mendeteksi apakah ada file *Fake HQ / Upsampled* (`<16 kHz`).
3. Klik **Jalankan Full QC Audit** untuk menghitung nilai **True Peak ($\text{dBTP}$)**, **Integrated Loudness ($\text{LUFS}$)**, dan **LRA ($\text{LU}$)**.
4. Klik tombol **`Pilih Bermasalah`** untuk mencentang semua lagu yang berstatus `CLIPPING HAZARD` atau `TRIM PREAMP`, lalu klik **`🎚️ Normalisasi Terpilih →`** untuk mengirimnya langsung ke Tahap 3.

### Tahap 3: `3. Converter & Loudness` (`/converter`)
1. Pilih **Mode Proses Audio**:
   * **Konversi ke MP3 (SoXR)**: Pilih sample rate ($44.1\text{ kHz}$ / $48.0\text{ kHz}$), bitrate ($320\text{k}$–$96\text{k}$), dan opsional aktifkan **Normalisasi $-14\text{ LUFS}$ / $-16\text{ LUFS}$**.
   * **Lossless Remux (`.opus`)**: Mengubah file `.webm` menjadi `.opus` secara instan tanpa *re-encode*.
   * **Normalisasi EBU R128**: Meratakan kekerasan lagu dan memasang limiter anti-kliping ($-1.5\text{ dBTP}$) dengan mempertahankan format/sample rate asli.
2. Pilih **Lokasi Penyimpanan Output** (*Folder Baru Otomatis*, *Timpa Asli*, atau *Folder Lain / USB*).
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
# 1. Audit QC folder audio lokal & ekspor laporan CSV:
python3 audio_manager.py scan "/path/ke/folder/audio" --out quality_report.csv

# 2. Unduh Native Audio (Opus 48kHz / AAC) + QC:
python3 audio_manager.py download "URL_TRACK_ATAU_PLAYLIST" --authorized --playlist --scan

# 3. Unduh langsung ke MP3 CBR 320 kbps:
python3 audio_manager.py download "URL_TRACK" --authorized --format mp3 --bitrate 320 --scan
```

---

## 8. Standar Audio QC & Metrik Soundsystem (EBU R128 & Spektrum)

| Metrik | Standar Aman FOH | Peringatan (Trim) | Bahaya (Clipping / Palsu) | Penjelasan Teknis |
| :--- | :--- | :--- | :--- | :--- |
| **True Peak ($\text{dBTP}$)** | $\le -1.0\text{ dBTP}$ | $-1.0\text{ s/d }0.0\text{ dBTP}$ | $> 0.0\text{ dBTP}$ | Puncak gelombang analog pasca-rekonstruksi DAC. Nilai $> 0\text{ dBTP}$ memicu *inter-sample clipping* pada tweeter/driver panggung. |
| **Integrated Loudness ($\text{LUFS}$)** | $-14\text{ s/d }-16\text{ LUFS}$ | $-9\text{ s/d }-13\text{ LUFS}$ | $> -8\text{ LUFS}$ | Kekerasan rata-rata lagu menurut standar EBU R128. |
| **Loudness Range ($\text{LRA}$)** | $5\text{ s/d }12\text{ LU}$ | $< 4\text{ LU}$ (Kompresi padat) | $> 18\text{ LU}$ (Terlalu dinamis) | Rentang dinamika antara bagian pelan dan keras dalam satu lagu. |
| **Spektrum Frekuensi** | `✨ 20kHz Asli` / `✓ 16kHz Full` | `Spektrum <15k` (Bitrate rendah) | `⚠️ Spektrum <16k (Upsampled)` | Rasio energi frekuensi tinggi untuk mendeteksi file *transcode* palsu. |

---

## 9. Dokumentasi REST API Internal

Server lokal [`web_ui.py`](file:///home/dedik/project/audio-library-starter/web_ui.py) menyediakan rute halaman HTML dan endpoint JSON RESTful:

### Rute Halaman HTML (`GET`)
* `GET /` atau `/index.html` $\rightarrow$ Stage 1: **Batch Audio Ingestion**
* `GET /qc` atau `/qc.html` $\rightarrow$ Stage 2: **Soundsystem QC & Spectral Lab**
* `GET /converter` atau `/converter.html` $\rightarrow$ Stage 3: **Converter & Loudness**
* `GET /organizer` atau `/organizer.html` $\rightarrow$ Stage 4: **Tag & File Organizer**

### Rute REST API (`/api/*`)
| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/system` | Memeriksa status ketersediaan binary (`python`, `yt_dlp`, `ffmpeg`, `ffprobe`). |
| `GET` | `/api/queue` | Mengambil status tugas aktif, persentase progress, *live logs*, dan riwayat antrian. |
| `GET` | `/api/library` | Mengambil daftar file audio, ringkasan folder playlist, dan cache QC (mendukung query `?source_dir=...`). |
| `GET` | `/api/fs/list` | Menjelajahi daftar direktori lokal & shortcut drive/USB untuk modal pemilih folder (`?path=...`). |
| `POST` | `/api/fs/mkdir` | Membuat subfolder baru di dalam direktori tujuan (`parent_dir`, `name`). |
| `POST` | `/api/fs/open-explorer` | Membuka folder sumber/playlist di File Manager sistem operasi (`source_dir`, `rel_path`). |
| `POST` | `/api/download` | Menjadwalkan tugas Batch Ingestion (`urls`, `audio_format`, `audio_bitrate`, `is_playlist`, `use_cookies`, `auto_scan`). |
| `POST` | `/api/scan` | Menjadwalkan audit penuh EBU R128 + Spektrum (`source_dir`). |
| `POST` | `/api/probe` | Memindai cepat metadata `ffprobe` + keaslian spektrum frekuensi (`source_dir`, `folder`, `probe_spectral`). |
| `POST` | `/api/resample` | Menjadwalkan konversi SoXR MP3, Lossless Remux `.opus`, atau Normalisasi EBU R128 (`mode`, `source_dir`, `dest_dir`, `rel_paths`, `target_rate`, `target_bitrate`, `normalize_lufs`, `overwrite`). |
| `POST` | `/api/rename` | Mengubah nama satu file audio atau satu folder playlist (`source_dir`, `rel_path`, `new_name`, `is_folder`). |
| `POST` | `/api/batch-rename` | Simulasi preview (`preview: true`) atau eksekusi (`preview: false`) Auto-Numbering & Pembersih Tag YouTube (`source_dir`, `rel_paths`, `numbering_mode`, `start_number`, `strip_yt_id`, `strip_junk_tags`, `clean_spaces`). |
| `POST` | `/api/delete` | Menghapus satu file, satu folder playlist, atau *batch delete* banyak file sekaligus (`source_dir`, `rel_path` / `rel_paths`, `is_folder`). |

---

## 10. Keamanan Aplikasi (Secure Coding Standards)

1. **Strict Localhost Binding:** Server HTTP diikat secara eksklusif ke `127.0.0.1:8765` dan tidak membuka port ke jaringan publik (`0.0.0.0`).
2. **Zero DOM XSS:** Seluruh kode JavaScript di `static/` menggunakan `document.createElement()`, `document.createElementNS()`, dan `textContent`. Tidak ada penggunaan `innerHTML`, `outerHTML`, `insertAdjacentHTML`, atau `document.write`.
3. **Strict Path Boundary Validation:** Semua operasi baca/ubah/hapus di [`fs_browser.py`](file:///home/dedik/project/audio-library-starter/fs_browser.py) meresolusi path absolut (`Path.resolve()`) dan memverifikasi bahwa target berada tepat di bawah direktori sumber yang diizinkan (mencegah *Path Traversal* `../`).
4. **Safe Subprocess Execution:** Pemanggilan `ffmpeg`, `ffprobe`, dan `yt-dlp` selalu menggunakan array argumen terstruktur tanpa `shell=True`.

---

## 11. Troubleshooting & FAQ

#### Q: Mengapa muncul peringatan "Database is locked" pada log Chrome?
**J:** Chrome di Linux mengunci file cookie saat browser sedang aktif. Sistem dilengkapi **Smart Fallback** yang otomatis beralih mengunduh via mode publik tanpa menghentikan antrian.

#### Q: Apakah memilih lagu di halaman QC akan hilang saat saya pindah ke halaman Converter atau Organizer?
**J:** Tidak. Aplikasi menggunakan **Shared Workspace State** (`sessionStorage`) yang menyimpan folder sumber aktif, filter playlist, dan daftar lagu yang dicentang saat Anda berpindah antar-halaman.

#### Q: Bagaimana cara menghapus semua file `.opus`/`.webm` setelah saya mengonversinya ke `.mp3`?
**J:** Buka halaman **`4. Tag & File Organizer`** (`/organizer`), klik tombol **`Pilih Non-MP3 (.opus/.webm)`** di kanan atas tabel (atau kelompokkan tabel dengan **`Grup: 🎵 Tipe File`**), lalu klik **`Hapus Terpilih`**.
