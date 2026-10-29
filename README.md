# SWARARIA AUDIO LAB — Audio Library & QC Manager

Program untuk programmer dan audio engineer: ambil audio yang kamu miliki atau punya izin unduh (opsional) dan **audit file audio lokal** dengan FFmpeg, lalu keluarkan CSV.

## Requirements

- Python 3.10+
- FFmpeg dan ffprobe ada di `PATH`: https://ffmpeg.org/download.html
- yt-dlp hanya untuk fitur unduhan yang diizinkan: `python -m pip install -U "yt-dlp[default]"`

Periksa instalasi:

```powershell
ffmpeg -version
ffprobe -version
yt-dlp --version
```

## Gunakan untuk koleksi audio lokal (tanpa YouTube)

```powershell
python audio_manager.py scan "D:\Music" --out quality_report.csv
```

## Periksa format yang tersedia di sumber yang diizinkan

```powershell
yt-dlp -F "URL_KONTEN_BERIZIN"
```

## Unduh file audio (Premium AAC 256k / Native Opus 48k / MP3 320k) + QC

Downloader mendukung pengambilan stream terbaik dengan fallback otomatis:

1. **Dengan Akun YouTube Premium (AAC 256 kbps High Quality)**:
   Otomatis membaca file `library/cookies.txt` jika tersedia, atau membaca sesi browser:

   ```bash
   python audio_manager.py download "URL_KONTEN_BERIZIN" --authorized --format premium --scan
   ```

2. **Native Opus 48kHz / AAC Standar FOH (Default Publik)**:
   Preservasi bit murni tanpa re-encoding (0% generasi degradasi):

   ```bash
   python audio_manager.py download "URL_KONTEN_BERIZIN" --authorized --scan
   ```

3. **MP3 320 kbps CBR (LAME Maximum Bitrate)**:
   Untuk kompatibilitas CDJ panggung lama atau flashdisk mobil:

   ```bash
   python audio_manager.py download "URL_KONTEN_BERIZIN" --authorized --format mp3 --scan
   ```

4. **Unduh Playlist Otomatis Masuk Folder**:
   Otomatis membuat subfolder sesuai nama playlist (`library/inbox/<Nama Playlist>/...`):
   ```bash
   python audio_manager.py download "URL_PLAYLIST_BERIZIN" --authorized --playlist --scan
   ```

`downloaded_ids.txt` mencegah trek dengan ID sama terunduh ulang pada run berikutnya. `--scan` mengecek ulang semua file (termasuk rekursif di dalam folder playlist).

## CSV

- `codec`: codec sumber; `lossless codec` bukan bukti **master** sumber lossless.
- `bitrate_kbps`: nilai yang dilaporkan metadata, bisa kosong/kurang bermakna untuk VBR.
- `integrated_lufs`: loudness keseluruhan, bukan skor mutu.
- `lra_lu`: loudness range.
- `true_peak_dbtp`: dBTP; > -1 dBTP diberi flag untuk pengecekan headroom, bukan otomatis gagal.
- `status`: `MEASURED`, `REVIEW`, `ERROR`. MEASURED bukan sertifikasi mutu.
- `sha256`: duplicate byte-identical saja, bukan fingerprint musikal.

File asli tidak diedit dan tidak dinormalisasi. Periksa setiap flag dengan telinga, spectrum analyzer dan kebutuhan DSP/loudspeaker.

## Batasan penting

- YouTube/YouTube Music dapat membatasi pengunduhan dan penggunaan konten. Gunakan hanya untuk konten yang memang boleh diunduh, dan pastikan hak pemutaran publik terpisah bila diputar pada event.
- WAV 24-bit hasil konversi Opus/AAC **tetap berkualitas sumber lossy**.
- Tidak ada detektor sederhana yang dapat membuktikan file berasal dari master studio. Spektrum, bitrate, dan codec hanya petunjuk.
- QC menghitung true peak dan memeriksa decode; tidak otomatis mengidentifikasi kualitas mastering, artefak audible, distorsi dari sumber, atau izin hak cipta.
