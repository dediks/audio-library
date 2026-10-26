#!/usr/bin/env python3
"""Audio Library Manager: authorized yt-dlp acquisition + local QC audit.

Requires: Python 3.10+, FFmpeg (ffmpeg/ffprobe on PATH), yt-dlp for download.
No DRM bypass, authentication bypass, or streaming-service extraction.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

EXTENSIONS = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".webm", ".flac",
              ".wav", ".aif", ".aiff", ".mka", ".wma", ".alac"}
LOSSLESS = {"flac", "alac", "wavpack", "ape", "tta", "pcm_s16le", "pcm_s24le",
            "pcm_s32le", "pcm_f32le", "pcm_f64le", "pcm_s16be", "pcm_s24be"}
FIELDNAMES = ["file", "codec", "source_class", "sample_rate_hz", "channels", "duration_s",
              "bitrate_kbps", "integrated_lufs", "lra_lu", "true_peak_dbtp", "status",
              "notes", "sha256"]


def require(program: str) -> None:
    if shutil.which(program) is None:
        raise RuntimeError(f"'{program}' tidak ditemukan di PATH. Silakan install terlebih dahulu.")


def get_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sha256_file(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def metadata(path: Path) -> dict:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    data = json.loads(proc.stdout)
    track = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if track is None:
        raise ValueError("Tidak ada stream audio")
    fmt = data.get("format", {})
    bitrate = get_float(track.get("bit_rate") or fmt.get("bit_rate"))
    return {
        "codec": track.get("codec_name", "unknown"),
        "sample_rate_hz": track.get("sample_rate", ""),
        "channels": track.get("channels", ""),
        "duration_s": get_float(track.get("duration") or fmt.get("duration")),
        "bitrate_kbps": round(bitrate / 1000, 1) if bitrate else "",
    }


def loudness(path: Path):
    # Does not modify or normalize the source. FFmpeg fully decodes and scans it.
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-xerror", "-i", str(path),
         "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError("Decode / analisis FFmpeg gagal: " + proc.stderr[-350:].replace("\n", " "))
    if "Summary:" not in proc.stderr:
        raise RuntimeError("FFmpeg tidak menghasilkan ringkasan EBU R128")
    summary = proc.stderr.rsplit("Summary:", 1)[-1]

    def grab(pattern):
        matched = re.search(pattern, summary, flags=re.MULTILINE | re.IGNORECASE)
        return get_float(matched.group(1)) if matched else None

    integrated = grab(r"^\s*I:\s*(-?[\d.]+)\s*LUFS")
    lra = grab(r"^\s*LRA:\s*(-?[\d.]+)\s*LU\b")
    true_peak = grab(r"True peak:\s*\n\s*Peak:\s*(-?[\d.]+)\s*dBFS")
    return integrated, lra, true_peak


def audit_one(path: Path) -> dict:
    row = {key: "" for key in FIELDNAMES}
    row["file"] = str(path)
    try:
        details = metadata(path)
        row.update(details)
        row["source_class"] = "lossless codec" if details["codec"] in LOSSLESS else "lossy / other codec"
        integrated, lra, true_peak = loudness(path)
        row["integrated_lufs"] = integrated if integrated is not None else ""
        row["lra_lu"] = lra if lra is not None else ""
        row["true_peak_dbtp"] = true_peak if true_peak is not None else ""
        flags = []
        if true_peak is None:
            flags.append("TRUE_PEAK_UNAVAILABLE")
        elif true_peak > 0:
            flags.append("TRUE_PEAK_ABOVE_0")
        elif true_peak > -1:
            flags.append("LOW_TRUE_PEAK_HEADROOM")
        if details["channels"] != 2:
            flags.append("CHECK_CHANNEL_LAYOUT")
        if integrated is None:
            flags.append("LUFS_UNAVAILABLE")
        row["status"] = "REVIEW" if flags else "MEASURED"
        row["notes"] = "; ".join(flags)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        row["status"] = "ERROR"
        row["notes"] = str(exc)[:350]
    return row


def scan(args) -> int:
    require("ffprobe")
    require("ffmpeg")
    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        raise RuntimeError(f"Folder tidak ada: {folder}")
    files = sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS)
    if not files:
        print("Tidak ada audio di folder tersebut.")
        return 0
    destination = Path(args.out).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    hashes = {}
    with destination.open("w", newline="", encoding="utf-8-sig") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDNAMES)
        writer.writeheader()
        for index, path in enumerate(files, 1):
            print(f"[{index}/{len(files)}] QC {path.name}", flush=True)
            row = audit_one(path)
            try:
                digest = sha256_file(path)
                row["sha256"] = digest
                if digest in hashes:
                    row["status"] = "REVIEW"
                    row["notes"] = (str(row["notes"]) + "; " if row["notes"] else "") + f"EXACT_DUPLICATE: {hashes[digest]}"
                else:
                    hashes[digest] = str(path)
            except OSError as exc:
                row["status"] = "ERROR"
                row["notes"] = (str(row["notes"]) + "; " if row["notes"] else "") + str(exc)
            writer.writerow(row)
    print(f"Selesai. Laporan: {destination.resolve()}")
    print("MEASURED hanya berarti pemindaian selesai tanpa flag, BUKAN bukti master berkualitas tinggi.")
    return 0


def download(args) -> int:
    if not args.authorized:
        raise RuntimeError("Hanya untuk sumber yang kamu miliki / diizinkan. Tambahkan --authorized jika sudah pasti.")
    require("yt-dlp")
    folder = Path(args.folder).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / "downloaded_ids.txt"
    if args.playlist:
        template = str(folder / "%(playlist_title,playlist|Playlist)s" / "%(title).150B [%(id)s].%(ext)s")
    else:
        template = str(folder / "%(title).150B [%(id)s].%(ext)s")
    
    selected_format = getattr(args, "format", "native")
    if selected_format == "premium":
        cmd = ["yt-dlp", "-f", "ba[format_id=141]/ba[ext=m4a]/ba/b"]
    else:
        cmd = ["yt-dlp", "-f", "ba/b"]

    if shutil.which("node"):
        cmd.extend(["--js-runtimes", "node"])
    cmd.extend([
        "--download-archive", str(archive),
        "-o", template,
        "--yes-playlist" if args.playlist else "--no-playlist",
    ])
    
    browser = getattr(args, "cookies_from_browser", None)
    if browser:
        cmd.extend(["--cookies-from-browser", browser])
    
    if selected_format == "premium":
        cmd.extend([
            "--extract-audio",
            "--audio-format", "m4a",
            "--audio-quality", "0",
            "--embed-metadata",
        ])
        print("Mengambil stream YouTube Premium (AAC 256 kbps / fallback ke native terbaik).", flush=True)
    elif selected_format == "mp3":
        cmd.extend([
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "320K",
            "--embed-metadata",
        ])
        print("Mengambil audio stream dan mengonversi ke MP3 320 kbps CBR (LAME).", flush=True)
    else:
        cmd.extend([
            "--extract-audio",
            "--audio-format", "best",
            "--audio-quality", "0",
            "--embed-metadata",
        ])
        print("Mengambil format native terbaik (Opus 48kHz / AAC) tanpa re-encoding [Kualitas Panggung & FOH].", flush=True)

    cmd.append(args.url)
    proc = subprocess.run(cmd)
    if proc.returncode != 0 and browser:
        print("[AUTH FALLBACK] Percobaan dengan cookies browser gagal. Mencoba ulang mode publik...", flush=True)
        fallback_cmd = [arg for i, arg in enumerate(cmd) if arg != "--cookies-from-browser" and (i == 0 or cmd[i-1] != "--cookies-from-browser")]
        proc = subprocess.run(fallback_cmd)

    if proc.returncode != 0:
        return proc.returncode
    if args.scan:
        return scan(argparse.Namespace(folder=str(folder), out=str(folder / "quality_report.csv")))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorized download + local audio quality audit")
    sub = parser.add_subparsers(dest="action", required=True)
    d = sub.add_parser("download", help="Download sumber yang memang diizinkan")
    d.add_argument("url")
    d.add_argument("--authorized", action="store_true", help="Saya memiliki izin sumber ini")
    d.add_argument("--format", choices=["native", "premium", "mp3"], default="native",
                   help="Format output: 'native' (Opus/M4A), 'premium' (AAC 256k YouTube Music), atau 'mp3' (320 kbps CBR)")
    d.add_argument("--playlist", action="store_true", help="Proses seluruh playlist (otomatis disimpan ke folder nama playlist)")
    d.add_argument("--cookies-from-browser", default=None,
                   help="Baca sesi login browser (contoh: chrome, firefox, brave) untuk akun YouTube Premium")
    d.add_argument("--folder", default="library/inbox")
    d.add_argument("--scan", action="store_true", help="Audit otomatis setelah download")
    s = sub.add_parser("scan", help="Audit file audio lokal tanpa download")
    s.add_argument("folder")
    s.add_argument("--out", default="quality_report.csv")
    args = parser.parse_args()
    try:
        return download(args) if args.action == "download" else scan(args)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
