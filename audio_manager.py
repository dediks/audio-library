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
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

EXTENSIONS = {".mp3", ".m4a", ".aac", ".opus", ".ogg", ".webm", ".flac",
              ".wav", ".aif", ".aiff", ".mka", ".wma", ".alac"}
LOSSLESS = {"flac", "alac", "wavpack", "ape", "tta", "pcm_s16le", "pcm_s24le",
            "pcm_s32le", "pcm_f32le", "pcm_f64le", "pcm_s16be", "pcm_s24be"}
FIELDNAMES = ["file", "codec", "source_class", "sample_rate_hz", "channels", "duration_s",
              "bitrate_kbps", "integrated_lufs", "lra_lu", "true_peak_dbtp",
              "spectral_status", "spectral_cutoff_khz", "spectral_label",
              "status", "notes", "sha256"]
ALLOWED_BITRATES = (320, 192, 128, 96)
ALLOWED_LUFS_TARGETS = (-14.0, -16.0)
TAG_FOLDER_PATTERN = r"\s*\[(?:44\.1kHz|48kHz|Opus|-14LUFS|-16LUFS)(?:[^\]]*)\]$"

# Priority order for YouTube / YouTube Music:
# 141 = Premium AAC 256 kbps (44.1 kHz)
# 774 = Premium Opus ~256 kbps (48 kHz)
# 251 = Public High Opus ~160 kbps (48 kHz)
# 140 = Standard AAC 128 kbps (44.1 kHz)
# Excludes -drc ("Stable Volume" dynamic range compressed) streams before final fallback.
YOUTUBE_AUDIO_SELECTOR = (
    "ba[format_id=141]/ba[format_id=774]/ba[format_id=251]/"
    "ba[format_id=140]/ba[format_id!*=-drc]/ba"
)

# Selector when specifically keeping Opus (.webm) alongside MP3 conversion:
YOUTUBE_OPUS_SELECTOR = (
    "ba[format_id=774]/ba[format_id=251]/"
    "ba[acodec=opus][format_id!*=-drc]/"
    + YOUTUBE_AUDIO_SELECTOR
)

STREAM_TIERS = {
    "141": "PREMIUM TIER — AAC 256 kbps (44.1 kHz, .m4a)",
    "774": "PREMIUM TIER — Opus ~256 kbps (48 kHz, .webm)",
    "251": "PUBLIC HIGH TIER — Opus ~160 kbps (48 kHz, .webm)",
    "140": "STANDARD TIER — AAC 128 kbps (44.1 kHz, .m4a)",
    "250": "LOW TIER — Opus ~70 kbps (48 kHz, .webm)",
    "249": "LOW TIER — Opus ~50 kbps (48 kHz, .webm)",
    "139": "LOW TIER — HE-AAC ~48 kbps (.m4a)",
}


def describe_format_tier(format_id: str) -> str:
    clean_id = format_id.strip()
    if clean_id in STREAM_TIERS:
        return f"[STREAM TIER] Format {clean_id}: {STREAM_TIERS[clean_id]}"
    if clean_id.endswith("-drc"):
        return f"[STREAM TIER] Format {clean_id}: WARNING — Dynamic Range Compressed (DRC) stream"
    return f"[STREAM TIER] Format {clean_id}: Audio stream terpilih"


def find_js_runtime() -> tuple[str | None, dict[str, str]]:
    """Finds Node.js or Bun runtime (including NVM / ~/.bun) and returns (runtime_spec, env)."""
    env = os.environ.copy()
    extra_bins: list[str] = []
    local_bin = Path.home() / ".local" / "bin"
    if local_bin.is_dir():
        extra_bins.append(str(local_bin))

    node_bin = shutil.which("node")
    if not node_bin:
        nvm_nodes = sorted(Path.home().glob(".nvm/versions/node/*/bin/node"), reverse=True)
        if nvm_nodes:
            node_bin = str(nvm_nodes[0])

    if node_bin:
        node_dir = str(Path(node_bin).parent)
        if node_dir not in extra_bins:
            extra_bins.insert(0, node_dir)
        if extra_bins:
            env["PATH"] = os.pathsep.join(extra_bins) + os.pathsep + env.get("PATH", "")
        return f"node:{node_bin}", env

    bun_bin = shutil.which("bun")
    if not bun_bin:
        cand_bun = Path.home() / ".bun" / "bin" / "bun"
        if cand_bun.is_file():
            bun_bin = str(cand_bun)

    if bun_bin:
        bun_dir = str(Path(bun_bin).parent)
        if bun_dir not in extra_bins:
            extra_bins.insert(0, bun_dir)
        if extra_bins:
            env["PATH"] = os.pathsep.join(extra_bins) + os.pathsep + env.get("PATH", "")
        return f"bun:{bun_bin}", env

    if extra_bins:
        env["PATH"] = os.pathsep.join(extra_bins) + os.pathsep + env.get("PATH", "")
    return None, env


def sync_download_archive(
    inbox_dir: Path,
    archive_file: Path,
    audio_format: str = "native",
    keep_opus: bool = False,
) -> int:
    """Prunes downloaded_ids.txt entries whose target file(s) do not exist in inbox_dir.

    This ensures that:
    1) If the user deleted a folder/song from inbox_dir, re-downloading works immediately.
    2) If the user previously downloaded .webm (native) and now downloads MP3 (or vice versa),
       yt-dlp is not blocked by the old archive entry.
    """
    if not archive_file.is_file():
        return 0

    mp3_ids: set[str] = set()
    opus_ids: set[str] = set()
    any_ids: set[str] = set()

    if inbox_dir.is_dir():
        for p in inbox_dir.rglob("*"):
            if p.is_file() and p.suffix.lower() in EXTENSIONS and not p.name.startswith("."):
                m = re.search(r"\[([A-Za-z0-9_-]{11})\]$", p.stem)
                if not m:
                    continue
                vid = m.group(1)
                ext = p.suffix.lower()
                any_ids.add(vid)
                if ext == ".mp3":
                    mp3_ids.add(vid)
                elif ext in (".webm", ".opus", ".ogg"):
                    opus_ids.add(vid)

    if audio_format in ("mp3", "mp3_320k", "mp3_vbr0"):
        valid_ids = (mp3_ids & opus_ids) if keep_opus else mp3_ids
    elif audio_format == "opus":
        valid_ids = opus_ids
    else:
        valid_ids = any_ids

    try:
        lines = archive_file.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return 0

    kept_lines: list[str] = []
    removed_count = 0
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split()
        vid = parts[-1] if parts else ""
        if vid in valid_ids:
            kept_lines.append(stripped)
        else:
            removed_count += 1

    if removed_count > 0:
        try:
            content = ("\n".join(kept_lines) + "\n") if kept_lines else ""
            archive_file.write_text(content, encoding="utf-8")
        except OSError:
            pass

    return removed_count


def run_ytdlp_process(
    cmd: list[str],
    env: dict[str, str] | None = None,
    existing_by_vid: dict[str, str] | None = None,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Executes yt-dlp subprocess and parses tier info, skipped files, cookie errors, and progress."""
    skipped_files: list[str] = []
    last_error_line = ""
    cookie_err_detected = False
    vid_map = existing_by_vid or {}
    log_fn = on_log or (lambda msg: print(msg, flush=True))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
        env=env,
    )
    if proc.stdout:
        for line in proc.stdout:
            clean_line = line.strip()
            if not clean_line:
                continue
            log_fn(clean_line)

            if any(
                k in clean_line.lower()
                for k in ("could not copy", "cookie database", "database is locked", "failed to extract cookies")
            ):
                cookie_err_detected = True

            if "ERROR:" in clean_line:
                last_error_line = clean_line.split("ERROR:", 1)[-1].strip()

            arch_match = re.search(
                r"\[download\]\s+([A-Za-z0-9_-]{11}):\s+has already been recorded in the archive",
                clean_line,
            )
            if arch_match:
                vid = arch_match.group(1)
                fname = vid_map.get(vid, f"Video ID [{vid}]")
                if fname not in skipped_files:
                    skipped_files.append(fname)
                log_fn(f"[SKIPPED] File sudah ada di Library: {fname}")

            disk_match = re.search(r"\[download\]\s+(.+?)\s+has already been downloaded", clean_line)
            if disk_match:
                fname = Path(disk_match.group(1)).name
                if fname not in skipped_files:
                    skipped_files.append(fname)
                log_fn(f"[SKIPPED] File sudah ada di Library: {fname}")

            fmt_match = re.search(r"Downloading \d+ format\(s\):\s*([^\s,]+)", clean_line)
            if fmt_match:
                log_fn(describe_format_tier(fmt_match.group(1)))

            if on_progress is not None:
                prog_match = re.search(r"\[download\]\s+([\d\.]+)%", clean_line)
                if prog_match:
                    try:
                        on_progress(min(99.0, float(prog_match.group(1))))
                    except ValueError:
                        pass

    returncode = proc.wait()
    return {
        "returncode": returncode,
        "skipped_files": skipped_files,
        "last_error_line": last_error_line,
        "cookie_err_detected": cookie_err_detected,
    }


def _run_ytdlp_with_tier_log(cmd: list[str], env: dict[str, str] | None = None) -> int:
    return run_ytdlp_process(cmd, env=env)["returncode"]


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


def analyze_spectral_quality(
    path: Path,
    codec: str = "",
    bitrate_kbps: float = 0.0,
    sample_rate_hz: int = 48000,
    duration_s: float = 0.0,
) -> dict:
    """Fast multi-band spectral high-frequency cutoff analyzer to detect fake/upsampled audio.

    Measures energy in 3 steep Butterworth filter bands over a 15s active window:
    - Mid band (400 - 6000 Hz)
    - High band (14.5 - 16.8 kHz)
    - Ultra-High Air band (> 17.2 kHz)
    """
    if sample_rate_hz and int(sample_rate_hz) < 32000:
        return {
            "spectral_status": "LOW_BW",
            "spectral_cutoff_khz": round(int(sample_rate_hz) / 2000, 1),
            "spectral_label": f"<{round(int(sample_rate_hz) / 2000)} kHz (Low SR)",
        }

    fc = (
        "[0:a:0]asplit=3[m][h][u];"
        "[m]highpass=f=400,lowpass=f=6000,astats=measure_perchannel=none[m_out];"
        "[h]highpass=f=14500,highpass=f=14500,highpass=f=14500,lowpass=f=16800,astats=measure_perchannel=none[h_out];"
        "[u]highpass=f=17200,highpass=f=17200,highpass=f=17200,highpass=f=17200,astats=measure_perchannel=none[u_out]"
    )

    seek_sec = 0.0
    if duration_s and duration_s > 35.0:
        seek_sec = min(40.0, max(10.0, round(duration_s * 0.25, 1)))
    elif duration_s and duration_s > 12.0:
        seek_sec = round(duration_s * 0.2, 1)

    cmd = ["ffmpeg", "-hide_banner", "-nostats"]
    if seek_sec > 0:
        cmd.extend(["-ss", str(seek_sec)])
    cmd.extend([
        "-t", "15",
        "-i", str(path),
        "-filter_complex", fc,
        "-map", "[m_out]", "-f", "null", "-",
        "-map", "[h_out]", "-f", "null", "-",
        "-map", "[u_out]", "-f", "null", "-",
    ])

    proc = subprocess.run(cmd, capture_output=True, text=True)
    blocks: dict[int, dict[str, float]] = {}
    for line in proc.stderr.splitlines():
        m = re.search(r"Parsed_astats_(\d+)", line)
        if not m:
            continue
        idx = int(m.group(1))
        b = blocks.setdefault(idx, {})
        if "RMS level dB:" in line:
            val = get_float(line.split("RMS level dB:")[-1].strip())
            if val is not None:
                b["rms"] = val
        elif "Peak level dB:" in line:
            val = get_float(line.split("Peak level dB:")[-1].strip())
            if val is not None:
                b["peak"] = val

    ordered = [blocks[k] for k in sorted(blocks)]
    if len(ordered) < 3:
        return {
            "spectral_status": "UNKNOWN",
            "spectral_cutoff_khz": 0,
            "spectral_label": "Spektrum N/A",
        }

    mid_rms = ordered[0].get("rms", -100.0)
    mid_peak = ordered[0].get("peak", -100.0)
    high_rms = ordered[1].get("rms", -120.0)
    high_peak = ordered[1].get("peak", -120.0)
    ultra_rms = ordered[2].get("rms", -120.0)
    ultra_peak = ordered[2].get("peak", -120.0)

    ultra_rel_rms = ultra_rms - mid_rms
    ultra_rel_peak = ultra_peak - mid_peak
    high_rel_rms = high_rms - mid_rms
    high_rel_peak = high_peak - mid_peak

    if ultra_rms > -86.0 and (ultra_rel_rms > -58.0 or ultra_rel_peak > -54.0):
        cutoff_khz = 20
    elif high_rms > -82.0 and (high_rel_rms > -54.0 or high_rel_peak > -50.0):
        cutoff_khz = 16
    else:
        cutoff_khz = 12

    codec_low = (codec or "").lower()
    br = float(bitrate_kbps or 0.0)
    claims_hq = (codec_low in LOSSLESS) or (codec_low == "mp3" and br >= 245.0) or (codec_low == "aac" and br >= 220.0)

    if cutoff_khz >= 20:
        return {
            "spectral_status": "AUTHENTIC",
            "spectral_cutoff_khz": 20,
            "spectral_label": "20 kHz Asli (Full HQ)",
        }
    if cutoff_khz == 16:
        if claims_hq:
            return {
                "spectral_status": "FAKE_HQ",
                "spectral_cutoff_khz": 16,
                "spectral_label": "⚠️ 16 kHz (Upsampled 128k)",
            }
        return {
            "spectral_status": "STANDARD",
            "spectral_cutoff_khz": 16,
            "spectral_label": "16 kHz (Standar)",
        }

    if claims_hq or br >= 190.0:
        return {
            "spectral_status": "FAKE_HQ",
            "spectral_cutoff_khz": 12,
            "spectral_label": "⚠️ <14 kHz (Fake HQ)",
        }
    return {
        "spectral_status": "LOW_BW",
        "spectral_cutoff_khz": 12,
        "spectral_label": "<14 kHz (Low-BW)",
    }


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
        spec = analyze_spectral_quality(
            path,
            codec=str(details.get("codec") or ""),
            bitrate_kbps=float(details.get("bitrate_kbps") or 0.0),
            sample_rate_hz=int(details.get("sample_rate_hz") or 48000),
            duration_s=float(details.get("duration_s") or 0.0),
        )
        row.update(spec)
        flags = []
        if true_peak is None:
            flags.append("TRUE_PEAK_UNAVAILABLE")
        elif true_peak > 0:
            flags.append("TRUE_PEAK_ABOVE_0")
        elif true_peak > -1:
            flags.append("LOW_TRUE_PEAK_HEADROOM")
        if spec.get("spectral_status") == "FAKE_HQ":
            flags.append("FAKE_HQ_UPSAMPLED")
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


def build_ytdlp_command(
    url: str,
    output_template: str,
    archive_file: Path,
    audio_format: str = "opus",
    keep_opus: bool = False,
    is_playlist: bool = False,
    cookies_file: Path | None = None,
    cookie_browser: str | None = None,
    js_runtime: str | None = None,
) -> tuple[list[str], str]:
    """Builds the yt-dlp command list and a human-readable target description."""
    norm_format = "opus" if audio_format in ("opus", "premium", "premium_aac") else audio_format
    if norm_format == "mp3":
        norm_format = "mp3_320k"

    cmd = ["yt-dlp"]
    if norm_format == "opus":
        # Prioritize 774 (Premium Opus 256k) then 251 (Public High Opus 160k),
        # extract to .opus via lossless stream copy (-c:a copy), and embed metadata
        cmd.extend([
            "-f", f"{YOUTUBE_OPUS_SELECTOR}/b",
            "--extract-audio",
            "--audio-format", "opus",
            "--embed-metadata",
        ])
    elif norm_format == "native":
        # Audio-only stream, kept as-is. Prioritize Premium 256k (141 AAC / 774 Opus),
        # then Public 160k 48kHz Opus (251), 128k AAC (140), and non-DRC streams.
        cmd.extend(["-f", YOUTUBE_AUDIO_SELECTOR])
    elif keep_opus:
        cmd.extend(["-f", f"{YOUTUBE_OPUS_SELECTOR}/b"])
    else:
        cmd.extend(["-f", f"{YOUTUBE_AUDIO_SELECTOR}/b"])

    if js_runtime:
        cmd.extend(["--js-runtimes", js_runtime])
    cmd.extend(["--remote-components", "ejs:github"])

    cmd.extend([
        "--download-archive", str(archive_file),
        "-o", output_template,
        "--yes-playlist" if is_playlist else "--no-playlist",
    ])

    auth_desc = "Public"
    if cookies_file and cookies_file.is_file():
        cmd.extend(["--cookies", str(cookies_file)])
        auth_desc = "cookies.txt"
    elif cookie_browser:
        cmd.extend(["--cookies-from-browser", cookie_browser])
        auth_desc = cookie_browser

    opus_note = " + Simpan File Asli Opus (.webm)" if keep_opus else ""
    if norm_format == "opus":
        desc = f"Target: Opus Best Quality (.opus) — Lossless Remux 48 kHz (Auth: {auth_desc})"
    elif norm_format == "mp3_320k":
        cmd.extend([
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "320K",
            "--embed-metadata",
        ])
        if keep_opus:
            cmd.append("--keep-video")
        desc = f"Target: MP3 320 kbps CBR{opus_note} (KONVERSI lossy, Auth: {auth_desc})"
    elif norm_format == "mp3_vbr0":
        cmd.extend([
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-metadata",
        ])
        if keep_opus:
            cmd.append("--keep-video")
        desc = f"Target: MP3 VBR 0{opus_note} (KONVERSI lossy, Auth: {auth_desc})"
    else:
        # Native: no postprocessing at all (no extract/convert/remux/metadata embed).
        desc = f"Target: Native Raw Stream - stream asli YouTube tanpa konversi (Auth: {auth_desc})"

    cmd.append(url)
    return cmd, desc


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

    selected_format = getattr(args, "format", "opus")
    keep_opus = bool(getattr(args, "keep_opus", False))
    if selected_format in ("premium", "premium_aac"):  # legacy alias
        selected_format = "opus"

    removed_stale = sync_download_archive(folder, archive, selected_format, keep_opus)
    if removed_stale > 0:
        print(f"[ARCHIVE SYNC] Membersihkan {removed_stale} ID riwayat lama yang file targetnya belum ada di {folder.name}.", flush=True)

    js_runtime, run_env = find_js_runtime()
    cookies_file = folder.parent / "cookies.txt"
    if not cookies_file.is_file():
        cookies_file = Path("library/cookies.txt").resolve()

    browser = getattr(args, "cookies_from_browser", None)
    if cookies_file.is_file():
        print(f"Menggunakan file sesi YouTube: {cookies_file}", flush=True)

    cmd, target_desc = build_ytdlp_command(
        url=args.url,
        output_template=template,
        archive_file=archive,
        audio_format=selected_format,
        keep_opus=keep_opus,
        is_playlist=bool(args.playlist),
        cookies_file=cookies_file if cookies_file.is_file() else None,
        cookie_browser=browser,
        js_runtime=js_runtime,
    )
    print(target_desc, flush=True)

    before_files = set(p for p in folder.rglob("*") if p.is_file())
    returncode = _run_ytdlp_with_tier_log(cmd, env=run_env)
    if returncode != 0 and browser:
        print("[AUTH FALLBACK] Percobaan dengan cookies browser gagal. Mencoba ulang mode publik...", flush=True)
        fallback_cmd, _ = build_ytdlp_command(
            url=args.url,
            output_template=template,
            archive_file=archive,
            audio_format=selected_format,
            keep_opus=keep_opus,
            is_playlist=bool(args.playlist),
            cookies_file=None,
            cookie_browser=None,
            js_runtime=js_runtime,
        )
        returncode = _run_ytdlp_with_tier_log(fallback_cmd, env=run_env)

    if returncode != 0:
        return returncode

    if shutil.which("ffprobe"):
        new_files = sorted(
            p for p in folder.rglob("*")
            if p.is_file() and p not in before_files and p.suffix.lower() in EXTENSIONS
        )
        for nf in new_files:
            try:
                info = metadata(nf)
                sr = f"{info['sample_rate_hz']} Hz" if info.get("sample_rate_hz") else "?"
                br = f"{info['bitrate_kbps']} kbps" if info.get("bitrate_kbps") else "VBR"
                print(
                    f"[STREAM VERIFIED] {nf.name} | Codec: {info['codec']} | Sample Rate: {sr} | Bitrate: {br}",
                    flush=True,
                )
            except Exception:
                pass

    if args.scan:
        return scan(argparse.Namespace(folder=str(folder), out=str(folder / "quality_report.csv")))
    return 0


def _has_mp3_xing_header(path: Path) -> bool:
    """Checks if an MP3 file contains a Xing/Info VBR header in the first 8 KB."""
    try:
        with path.open("rb") as fh:
            head_bytes = fh.read(8192)
            return b"Xing" in head_bytes or b"Info" in head_bytes
    except OSError:
        return False


def _select_resample_codec_args(
    ext: str,
    codec: str,
    target_rate: int,
    target_bitrate: int,
) -> tuple[str, list[str]]:
    """Determines the target file extension and FFmpeg audio encoder arguments."""
    mp3_codec_args = [
        "-c:a", "libmp3lame",
        "-b:a", f"{target_bitrate}k",
        "-ac", "2",
        "-write_xing", "0",
        "-id3v2_version", "3",
    ]
    if ext in (".webm", ".opus", ".ogg") or codec == "opus":
        if target_rate == 44100 or target_bitrate != 320:
            return ".mp3", mp3_codec_args
        return (".opus" if ext != ".webm" else ".webm"), ["-c:a", "libopus", "-b:a", "256k", "-ac", "2"]
    if ext == ".mp3" or codec == "mp3":
        return ".mp3", mp3_codec_args
    if ext in (".m4a", ".aac"):
        if target_bitrate != 320:
            return ".mp3", mp3_codec_args
        return ext, ["-c:a", "aac", "-b:a", "256k", "-ac", "2"]
    if ext == ".flac" or codec == "flac":
        if target_bitrate != 320:
            return ".mp3", mp3_codec_args
        return ".flac", ["-c:a", "flac", "-ac", "2"]
    if ext in (".wav", ".aif", ".aiff"):
        if target_bitrate != 320:
            return ".mp3", mp3_codec_args
        pcm_codec = codec if codec.startswith("pcm_") else "pcm_s16le"
        return ext, ["-c:a", pcm_codec, "-ac", "2"]
    return ".mp3", mp3_codec_args


def _resolve_resample_output_path(
    path: Path,
    target_ext: str,
    tag_label: str,
    overwrite: bool,
    out_dir: Path | None,
) -> Path:
    """Resolves the destination file path for resample_one while preserving folder organization."""
    if overwrite:
        return path.with_suffix(target_ext)
    if out_dir is not None:
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir / f"{path.stem}{target_ext}"
    if path.parent.name and path.parent.name != "inbox" and path.parent.parent.name == "inbox":
        base_folder = re.sub(TAG_FOLDER_PATTERN, "", path.parent.name)
        dest_dir = path.parent.parent / f"{base_folder} [{tag_label}]"
        dest_dir.mkdir(parents=True, exist_ok=True)
        return dest_dir / f"{path.stem}{target_ext}"
    if path.parent.name == "inbox":
        dest_dir = path.parent / f"Converted [{tag_label}]"
        dest_dir.mkdir(parents=True, exist_ok=True)
        return dest_dir / f"{path.stem}{target_ext}"
    clean_stem = re.sub(TAG_FOLDER_PATTERN, "", path.stem)
    return path.with_name(f"{clean_stem} [{tag_label}]{target_ext}")


def remux_to_opus_one(
    path: Path,
    overwrite: bool = False,
    out_dir: Path | None = None,
) -> dict:
    """Losslessly remuxes an Opus stream (e.g. from .webm or .ogg) into a standard .opus container (-c:a copy).

    Does NOT re-encode audio data (0% quality degradation, bit-exact stream copy).
    If the input file is already .opus or does not contain an Opus audio stream, it is safely skipped.
    """
    require("ffmpeg")
    require("ffprobe")

    ext = path.suffix.lower()
    info = metadata(path)
    codec = info.get("codec", "")
    current_rate = int(info.get("sample_rate_hz") or 48000)
    current_br = float(info.get("bitrate_kbps") or 0)

    if ext == ".opus":
        return {
            "status": "SKIPPED",
            "file": str(path),
            "old_rate": current_rate,
            "new_rate": current_rate,
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(current_br) if current_br else "",
            "message": "Sudah berformat .opus (dilewati)",
        }

    if codec != "opus":
        return {
            "status": "SKIPPED",
            "file": str(path),
            "old_rate": current_rate,
            "new_rate": current_rate,
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(current_br) if current_br else "",
            "message": f"Bukan stream Opus (codec: {codec or ext}), dilewati agar tidak terjadi re-encode",
        }

    out_path = _resolve_resample_output_path(path, ".opus", "Opus", overwrite, out_dir)

    if not overwrite and out_path != path and out_path.is_file():
        return {
            "status": "SKIPPED",
            "file": str(out_path),
            "old_rate": current_rate,
            "new_rate": current_rate,
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(current_br) if current_br else "",
            "message": f"Hasil .opus sudah ada ({out_path.parent.name}/{out_path.name})",
        }

    tmp_path = out_path.with_name(f".{out_path.stem}.remux_tmp.opus")
    try:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-nostats", "-xerror",
            "-i", str(path),
            "-map", "0:a:0",
            "-map_metadata", "0",
            "-c:a", "copy",
            str(tmp_path),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError("FFmpeg lossless remux gagal: " + proc.stderr[-300:].replace("\n", " "))

        new_info = metadata(tmp_path)
        tmp_path.replace(out_path)
        if overwrite and out_path != path and path.exists():
            path.unlink()

        dest_display = f"{out_path.parent.name}/{out_path.name}" if out_path.parent != path.parent else out_path.name
        new_br = float(new_info.get("bitrate_kbps") or current_br)
        return {
            "status": "CONVERTED",
            "file": str(out_path),
            "old_file": str(path),
            "overwritten": overwrite,
            "old_rate": current_rate,
            "new_rate": int(new_info.get("sample_rate_hz") or current_rate),
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(new_br) if new_br else "",
            "codec": "opus",
            "message": f"Lossless Remux {ext} -> .opus ({current_rate} Hz, -c:a copy) -> {dest_display}",
        }
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def resample_one(
    path: Path,
    target_rate: int = 44100,
    target_bitrate: int = 320,
    overwrite: bool = False,
    out_dir: Path | None = None,
    normalize_lufs: float | None = None,
) -> dict:
    """Resamples an existing audio file to target_rate (44100/48000 Hz) and target_bitrate (320/192/128/96 kbps).

    Optionally applies EBU R128 loudness normalization (e.g. -14.0 or -16.0 LUFS with -1.5 dBTP True Peak limit).
    By default (overwrite=False), never overwrites the original file:
    - If inside a playlist folder (e.g. 'Top songs/Lagu.mp3'), writes to
      'Top songs [44.1kHz]/Lagu.mp3' or 'Top songs [44.1kHz 192k]/Lagu.mp3'.
    - Otherwise writes to 'Converted [...]/Lagu.mp3' or 'Lagu [...].mp3'.
    Uses FFmpeg SoXR 28-bit high-precision resampler (with standard fallback).
    """
    require("ffmpeg")
    require("ffprobe")
    if target_rate not in (44100, 48000):
        raise ValueError("Target sample rate hanya mendukung 44100 atau 48000 Hz.")
    if target_bitrate not in ALLOWED_BITRATES:
        raise ValueError(f"Target bitrate hanya mendukung {ALLOWED_BITRATES} kbps.")
    if normalize_lufs is not None:
        normalize_lufs = float(normalize_lufs)
        if normalize_lufs not in ALLOWED_LUFS_TARGETS:
            raise ValueError(f"Target normalisasi hanya mendukung {ALLOWED_LUFS_TARGETS} LUFS.")

    info = metadata(path)
    current_rate = int(info.get("sample_rate_hz") or 0)
    current_br = float(info.get("bitrate_kbps") or 0)
    current_ch = int(info.get("channels") or 0)
    codec = info.get("codec", "")
    ext = path.suffix.lower()
    rate_label = "44.1kHz" if target_rate == 44100 else "48kHz"
    tag_label = rate_label if target_bitrate == 320 else f"{rate_label} {target_bitrate}k"
    if normalize_lufs is not None:
        tag_label = f"{tag_label} {int(normalize_lufs)}LUFS"

    rate_matches = (current_rate == target_rate)
    has_xing = _has_mp3_xing_header(path) if ext == ".mp3" else False
    br_matches = (ext == ".mp3" and abs(current_br - target_bitrate) <= 8 and current_ch == 2 and not has_xing)

    if rate_matches and br_matches and normalize_lufs is None:
        return {
            "status": "SKIPPED",
            "file": str(path),
            "old_rate": current_rate,
            "new_rate": current_rate,
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": target_bitrate,
            "message": f"Sudah {target_rate} Hz • {target_bitrate} kbps (dilewati)",
        }

    target_ext, codec_args = _select_resample_codec_args(ext, codec, target_rate, target_bitrate)
    out_path = _resolve_resample_output_path(path, target_ext, tag_label, overwrite, out_dir)

    # Skip if non-overwrite target file already exists with target sample rate and bitrate
    if not overwrite and out_path != path and out_path.is_file():
        try:
            existing_info = metadata(out_path)
            ex_rate = int(existing_info.get("sample_rate_hz") or 0)
            ex_br = float(existing_info.get("bitrate_kbps") or 0)
            if ex_rate == target_rate and abs(ex_br - target_bitrate) <= 8:
                return {
                    "status": "SKIPPED",
                    "file": str(out_path),
                    "old_rate": current_rate,
                    "new_rate": target_rate,
                    "old_bitrate": round(current_br) if current_br else "",
                    "new_bitrate": target_bitrate,
                    "message": f"Hasil konversi sudah ada ({out_path.parent.name}/{out_path.name})",
                }
        except Exception:
            pass

    tmp_path = out_path.with_name(f".{out_path.stem}.resample_tmp{out_path.suffix}")
    try:
        base_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-nostats", "-xerror",
            "-i", str(path),
            "-map", "0:a:0",
            "-map_metadata", "0",
        ]
        ln_prefix = f"loudnorm=I={normalize_lufs}:TP=-1.5:LRA=11," if normalize_lufs is not None else ""
        cmd_soxr = base_cmd + [
            "-af", f"{ln_prefix}aresample=resampler=soxr:precision=28:osr={target_rate}",
            "-ar", str(target_rate),
            *codec_args,
            str(tmp_path),
        ]
        proc = subprocess.run(cmd_soxr, capture_output=True, text=True)
        if proc.returncode != 0:
            fallback_af = ["-af", f"loudnorm=I={normalize_lufs}:TP=-1.5:LRA=11"] if normalize_lufs is not None else []
            cmd_std = base_cmd + [
                *fallback_af,
                "-ar", str(target_rate),
                *codec_args,
                str(tmp_path),
            ]
            proc = subprocess.run(cmd_std, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError("FFmpeg resample gagal: " + proc.stderr[-300:].replace("\n", " "))

        new_info = metadata(tmp_path)
        tmp_path.replace(out_path)
        if overwrite and out_path != path and path.exists():
            path.unlink()

        dest_display = f"{out_path.parent.name}/{out_path.name}" if out_path.parent != path.parent else out_path.name
        old_br_label = f"{round(current_br)}k" if current_br else codec
        norm_suffix = f" • EBU R128 {int(normalize_lufs)} LUFS" if normalize_lufs is not None else ""
        return {
            "status": "CONVERTED",
            "file": str(out_path),
            "old_file": str(path),
            "overwritten": overwrite,
            "old_rate": current_rate,
            "new_rate": int(new_info.get("sample_rate_hz") or target_rate),
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": target_bitrate,
            "codec": new_info.get("codec", ""),
            "normalized_lufs": normalize_lufs,
            "message": f"{current_rate} Hz ({old_br_label}) -> {target_rate} Hz • {target_bitrate} kbps{norm_suffix} ({dest_display})",
        }
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def normalize_one(
    path: Path,
    target_lufs: float = -14.0,
    overwrite: bool = False,
    out_dir: Path | None = None,
) -> dict:
    """Normalizes audio loudness to target_lufs (-14.0 or -16.0 LUFS) with -1.5 dBTP True Peak limiter (EBU R128).

    Preserves the track's existing sample rate (44.1 kHz or 48 kHz) and container/format family.
    """
    require("ffmpeg")
    require("ffprobe")
    target_lufs = float(target_lufs)
    if target_lufs not in ALLOWED_LUFS_TARGETS:
        raise ValueError(f"Target normalisasi hanya mendukung {ALLOWED_LUFS_TARGETS} LUFS.")

    info = metadata(path)
    current_rate = int(info.get("sample_rate_hz") or 48000)
    out_rate = 44100 if current_rate == 44100 else 48000
    current_br = float(info.get("bitrate_kbps") or 0)
    codec = info.get("codec", "")
    ext = path.suffix.lower()

    if ext in (".webm", ".opus", ".ogg") or codec == "opus":
        target_ext = ".opus"
        codec_args = ["-c:a", "libopus", "-b:a", "256k", "-ac", "2"]
    elif ext in (".m4a", ".aac"):
        target_ext = ext
        codec_args = ["-c:a", "aac", "-b:a", "256k", "-ac", "2"]
    elif ext == ".flac" or codec == "flac":
        target_ext = ".flac"
        codec_args = ["-c:a", "flac", "-ac", "2"]
    elif ext in (".wav", ".aif", ".aiff"):
        target_ext = ext
        pcm_codec = codec if codec.startswith("pcm_") else "pcm_s16le"
        codec_args = ["-c:a", pcm_codec, "-ac", "2"]
    else:
        target_ext = ".mp3"
        codec_args = [
            "-c:a", "libmp3lame",
            "-b:a", "320k",
            "-ac", "2",
            "-write_xing", "0",
            "-id3v2_version", "3",
        ]

    tag_label = f"{int(target_lufs)}LUFS"
    out_path = _resolve_resample_output_path(path, target_ext, tag_label, overwrite, out_dir)

    if not overwrite and out_path != path and out_path.is_file():
        return {
            "status": "SKIPPED",
            "file": str(out_path),
            "old_rate": current_rate,
            "new_rate": out_rate,
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(current_br) if current_br else "",
            "message": f"Hasil normalisasi {int(target_lufs)} LUFS sudah ada ({out_path.parent.name}/{out_path.name})",
        }

    tmp_path = out_path.with_name(f".{out_path.stem}.norm_tmp{out_path.suffix}")
    try:
        base_cmd = [
            "ffmpeg", "-y", "-hide_banner", "-nostats", "-xerror",
            "-i", str(path),
            "-map", "0:a:0",
            "-map_metadata", "0",
        ]
        cmd_soxr = base_cmd + [
            "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11,aresample=resampler=soxr:precision=28:osr={out_rate}",
            "-ar", str(out_rate),
            *codec_args,
            str(tmp_path),
        ]
        proc = subprocess.run(cmd_soxr, capture_output=True, text=True)
        if proc.returncode != 0:
            cmd_std = base_cmd + [
                "-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
                "-ar", str(out_rate),
                *codec_args,
                str(tmp_path),
            ]
            proc = subprocess.run(cmd_std, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError("FFmpeg loudnorm gagal: " + proc.stderr[-300:].replace("\n", " "))

        new_info = metadata(tmp_path)
        tmp_path.replace(out_path)
        if overwrite and out_path != path and path.exists():
            path.unlink()

        dest_display = f"{out_path.parent.name}/{out_path.name}" if out_path.parent != path.parent else out_path.name
        new_br = float(new_info.get("bitrate_kbps") or current_br)
        return {
            "status": "CONVERTED",
            "file": str(out_path),
            "old_file": str(path),
            "overwritten": overwrite,
            "old_rate": current_rate,
            "new_rate": int(new_info.get("sample_rate_hz") or out_rate),
            "old_bitrate": round(current_br) if current_br else "",
            "new_bitrate": round(new_br) if new_br else "",
            "codec": new_info.get("codec", ""),
            "normalized_lufs": target_lufs,
            "message": f"EBU R128 {int(target_lufs)} LUFS (TP -1.5 dBTP) • {out_rate} Hz -> {dest_display}",
        }
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def resample(args) -> int:
    require("ffmpeg")
    require("ffprobe")
    target = Path(args.target).expanduser().resolve()
    if not target.exists():
        raise RuntimeError(f"Path tidak ditemukan: {target}")

    out_dir = Path(args.out_dir).expanduser().resolve() if getattr(args, "out_dir", None) else None
    target_bitrate = int(getattr(args, "bitrate", 320))
    remux_opus = bool(getattr(args, "remux_opus", False))

    if target.is_file():
        files = [target]
    else:
        if remux_opus:
            allowed_exts = {".webm", ".ogg"}
        elif args.only_mp3:
            allowed_exts = {".mp3"}
        else:
            allowed_exts = EXTENSIONS
        files = sorted(
            p for p in target.rglob("*")
            if p.is_file()
            and p.suffix.lower() in allowed_exts
            and not p.name.startswith(".")
            and not re.search(TAG_FOLDER_PATTERN, p.parent.name)
        )

    if not files:
        print("Tidak ada file audio yang cocok untuk dikonversi.")
        return 0

    converted = 0
    skipped = 0
    errors = 0
    for idx, path in enumerate(files, 1):
        try:
            if remux_opus:
                res = remux_to_opus_one(
                    path,
                    overwrite=args.overwrite,
                    out_dir=out_dir,
                )
            else:
                res = resample_one(
                    path,
                    target_rate=args.rate,
                    target_bitrate=target_bitrate,
                    overwrite=args.overwrite,
                    out_dir=out_dir,
                )
            if res["status"] == "CONVERTED":
                converted += 1
                print(f"[{idx}/{len(files)}] CONVERTED: {res['message']}", flush=True)
            else:
                skipped += 1
                print(f"[{idx}/{len(files)}] SKIPPED: {path.name} ({res['message']})", flush=True)
        except Exception as exc:
            errors += 1
            print(f"[{idx}/{len(files)}] ERROR {path.name}: {exc}", file=sys.stderr, flush=True)

    print(f"Selesai. Dikonversi: {converted} | Dilewati: {skipped} | Error: {errors}")
    if args.scan and target.is_dir():
        return scan(argparse.Namespace(folder=str(target), out=str(target / "quality_report.csv")))
    return 0 if errors == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Authorized download + local audio quality audit")
    sub = parser.add_subparsers(dest="action", required=True)
    d = sub.add_parser("download", help="Download sumber yang memang diizinkan")
    d.add_argument("url")
    d.add_argument("--authorized", action="store_true", help="Saya memiliki izin sumber ini")
    d.add_argument("--format", choices=["opus", "native", "mp3", "mp3_320k", "mp3_vbr0", "premium"], default="opus",
                   help="'opus' (default): Best Quality Opus (.opus) 48 kHz dengan lossless remux & embedded metadata. 'native': stream mentah asli YouTube (.webm/.m4a). 'mp3': konversi MP3 320 kbps.")
    d.add_argument("--keep-opus", action="store_true",
                   help="Saat download --format mp3, tetap simpan juga file asli Opus (.webm) (default: tidak aktif)")
    d.add_argument("--playlist", action="store_true", help="Proses seluruh playlist (otomatis disimpan ke folder nama playlist)")
    d.add_argument("--cookies-from-browser", default=None,
                   help="Baca sesi login browser (contoh: chrome, firefox, brave) untuk akun YouTube Premium")
    d.add_argument("--folder", default="library/inbox")
    d.add_argument("--scan", action="store_true", help="Audit otomatis setelah download")
    s = sub.add_parser("scan", help="Audit file audio lokal tanpa download")
    s.add_argument("folder")
    s.add_argument("--out", default="quality_report.csv")
    r = sub.add_parser("resample", help="Konversi sample rate & bitrate lagu yang sudah ada")
    r.add_argument("target", help="Path ke file audio atau folder koleksi")
    r.add_argument("--rate", type=int, choices=[44100, 48000], default=44100,
                   help="Target sample rate dalam Hz (default: 44100 untuk 44.1 kHz)")
    r.add_argument("--bitrate", type=int, choices=[320, 192, 128, 96], default=320,
                   help="Target bitrate MP3 dalam kbps: 320, 192, 128, atau 96 (default: 320)")
    r.add_argument("--only-mp3", action="store_true",
                   help="Hanya konversi file .mp3 (biarkan file .webm/.opus tetap utuh)")
    r.add_argument("--remux-opus", action="store_true",
                   help="Lossless remux file .webm/.ogg (Opus) menjadi wadah .opus (-c:a copy) tanpa re-encode")
    r.add_argument("--overwrite", action="store_true",
                   help="Timpa file asli secara langsung (default: TIDAK menimpa file asli)")
    r.add_argument("--out-dir", default=None,
                   help="Folder tujuan khusus untuk menyimpan hasil konversi")
    r.add_argument("--scan", action="store_true", help="Audit ulang folder setelah konversi selesai")
    args = parser.parse_args()
    try:
        if args.action == "download":
            return download(args)
        if args.action == "resample":
            return resample(args)
        return scan(args)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
