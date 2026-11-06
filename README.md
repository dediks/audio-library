# SWARARIA AUDIO LAB — Pro Audio Library, FOH QC & DSP Workstation

Workstation lokal berbasis web & CLI untuk **Audio Engineer**, **Operator FOH / Soundsystem**, **DJ**, dan **Event Organizer**. Dirancang dengan estetika **shadcn/ui Dark High-Contrast** dan arsitektur **4 Halaman Dedicated** yang terhubung melalui *Shared Workspace State*.

---

## ✨ Fitur Utama (4-Stage Audio Engineering Pipeline)

1. **`1. Ingest` (`/`) — Batch Audio Ingestion**
   - Ekstraksi audio berizin dari URL/Playlist dengan *Smart Fallback* (`Native .opus 48kHz`, `Native AAC .m4a`, atau `MP3 CBR 320k/192k/128k/96k`).
   - Penyimpanan otomatis per folder playlist (`library/inbox/<Nama Playlist>/`) dan *Live Extraction Stream Monitor*.

2. **`2. QC & Spectral Lab` (`/qc`) — Soundsystem QC & Anti-Fake Bitrate**
   - **4 Kartu Diagnostik KPI FOH**: Memantau jumlah trek *🟢 Ready for FOH ($\le -1.0\text{ dBTP}$)*, *🟡 Trim Preamp ($-1.0\text{ s/d }0\text{ dBTP}$)*, dan *🔴 Clipping Hazard / Fake HQ*.
   - **Detektor Spektrum Palsu (*Fake 320 kbps Detector*)**: Membandingkan energi frekuensi tinggi ($16\text{ kHz}$ & $20\text{ kHz}$) terhadap energi dasar ($1\text{ kHz}$) untuk mendeteksi file *transcode* palsu hasil *upsample* dari $128\text{ kbps}$.
   - **Pintasan 1-Klik ke Normalizer**: Pilih semua lagu bermasalah lalu kirim langsung ke halaman *Converter & Loudness*.

3. **`3. Converter & Loudness` (`/converter`) — SoXR 28-bit & EBU R128 Normalizer**
   - **Resampling Presisi Tinggi (SoXR 28-bit VHQ)**: Konversi massal ke MP3 CBR ($44.1\text{ kHz}$ untuk CDJ/USB atau $48\text{ kHz}$ untuk Digital Mixer FOH).
   - **Lossless Remux (`.webm` $\rightarrow$ `.opus`)**: Memindahkan *container* tanpa *re-encode* (100% kualitas asli, sangat cepat).
   - **Auto Loudness Normalization & True Peak Limiter**: Meratakan kekerasan lagu ke **$-14\text{ LUFS}$** (Standar FOH/Event) atau **$-16\text{ LUFS}$** sekaligus mengunci batas puncak di **$-1.5\text{ dBTP}$** (bebas kliping DAC).

4. **`4. Tag & File Organizer` (`/organizer`) — Auto-Numbering, Grouping & Batch Delete**
   - **Studio Auto-Numbering & Pembersih Tag YouTube**: Memberi nomor urut track otomatis (`01 - `, `001 - `, `01. `) dan menghapus tag sampah (`[ID_YouTube]`, `(Official Music Video)`, `(Lyrics)`, `[HD]`, `[4K]`) dengan **Live Diff Preview (`Nama Lama → Nama Baru`)**.
   - **Multi-Mode Grouping**: Kelompokkan tabel berdasarkan `Folder Playlist`, `Tipe File (.opus/.webm/.mp3)`, `Folder + Tipe File`, atau `Sample Rate`.
   - **Manajemen File Lengkap**: Rename file/folder, hapus 1 file, hapus 1 folder playlist, hapus 1 grup tipe file, atau *Batch Delete* berdasarkan pilihan *checkbox*.

---

## 🛠️ Prasyarat

- **Python 3.10+** (Centang *"Add Python to PATH"* saat instalasi di Windows)
- **FFmpeg & ffprobe** terpasang di `PATH`: https://ffmpeg.org/download.html
  - *Windows*: `winget install Gyan.FFmpeg`
  - *macOS*: `brew install ffmpeg`
  - *Linux (Ubuntu/Debian)*: `sudo apt update && sudo apt install -y ffmpeg`

---

## 🚀 Menjalankan Aplikasi (Desktop App & Web Workstation)

Aplikasi ini dapat dijalankan dalam **2 mode**:
1. **Desktop App Mode (`desktop_app.py`)**: Membuka jendela aplikasi desktop mandiri (*Native OS Window* via `pywebview` atau *Standalone App Window*).
2. **Web Server Mode (`web_ui.py`)**: Menjalankan server lokal di `http://127.0.0.1:8765` untuk diakses lewat browser.

### Cara 1-Klik (Otomatis Setup `.venv` + Dependencies + Buka Jendela Desktop):
* **🪟 Windows**: Cukup **klik 2x file `run.bat`** (atau ketik `run.bat` di CMD/PowerShell).
* **🍎 macOS & 🐧 Linux**: Jalankan `./run.sh` di terminal (atau `./run.sh --web` untuk mode browser saja).

---

## 📦 Membuat Installer / Aplikasi Desktop Mandiri untuk Orang Awam (`.exe` / `.app`)

Jika Anda ingin membagikan aplikasi ini ke **orang awam** agar mereka **tidak perlu menginstall Python maupun FFmpeg**, Anda dapat mem-build aplikasi ini menjadi paket Desktop Mandiri (*Standalone Executable*):

```bash
# Otomatis menyalin FFmpeg/ffprobe ke dalam bundle & mem-build aplikasi dengan PyInstaller:
python build_desktop.py --install-deps
```

Hasil build akan tersedia di folder **`dist/SwarariaAudioLab/`**:
- **Windows**: Klik 2x `dist\SwarariaAudioLab\SwarariaAudioLab.exe` (langsung jalan tanpa perlu install Python/FFmpeg!).
- **Membuat File Setup Installer (`SwarariaAudioLab_Setup.exe`)**:
  Buka file **`installer.iss`** menggunakan [Inno Setup Compiler](https://jrsoftware.org/isdl.php) di Windows lalu klik **Compile**. Anda akan mendapatkan 1 file installer `dist\SwarariaAudioLab_Setup.exe` lengkap dengan shortcut Desktop & Start Menu!

---

### Alternatif Manual (Mode Developer):
```bash
# 1. Buat & aktifkan virtual environment
python3 -m venv .venv
source .venv/bin/activate       # Di Windows: .venv\Scripts\activate.bat

# 2. Pasang dependensi
pip install -r requirements.txt

# 3. Jalankan sebagai Desktop App ATAU Web Server
python3 desktop_app.py          # Mode Jendela Desktop
python3 web_ui.py               # Mode Server Browser (http://127.0.0.1:8765)
```

Halaman Workstation:
- **Stage 1 — Ingest**: `http://127.0.0.1:8765/`
- **Stage 2 — QC & Spectral Lab**: `http://127.0.0.1:8765/qc`
- **Stage 3 — Converter & Loudness**: `http://127.0.0.1:8765/converter`
- **Stage 4 — Tag & File Organizer**: `http://127.0.0.1:8765/organizer`

---

## 💻 Penggunaan CLI (`audio_manager.py`)

### 1. Audit Koleksi Audio Lokal ke CSV (Tanpa YouTube)
```bash
python3 audio_manager.py scan "/path/ke/koleksi/musik" --out quality_report.csv
```

### 2. Unduh Audio Berizin + Audit QC Otomatis
```bash
# Native Opus 48kHz / AAC (0% Generation Loss):
python3 audio_manager.py download "URL_KONTEN_BERIZIN" --authorized --scan

# MP3 320 kbps CBR (Kompatibilitas CDJ / USB):
python3 audio_manager.py download "URL_KONTEN_BERIZIN" --authorized --format mp3 --bitrate 320 --scan

# Playlist Otomatis Masuk Subfolder:
python3 audio_manager.py download "URL_PLAYLIST_BERIZIN" --authorized --playlist --scan
```

---

## 📖 Dokumentasi Teknis Lengkap

Lihat [**`DOCUMENTATION.md`**](./DOCUMENTATION.md) untuk penjelasan mendalam mengenai arsitektur 4 halaman, algoritma deteksi spektrum palsu, standar EBU R128 / True Peak ($\text{dBTP}$), serta spesifikasi lengkap REST API internal.
