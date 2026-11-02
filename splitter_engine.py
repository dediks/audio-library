#!/usr/bin/env python3
"""Multitrack WAV & Concert Video Auto-Splitter Engine.

Provides:
1. Target inspection for long concert videos, polyphonic multichannel WAVs (e.g., X32/M32 X-Live),
   and folders of synchronized multi-stem WAV files.
2. Automatic song boundary detection via embedded chapters, FFmpeg silence/energy drop detection,
   and adaptive RMS valley analysis, plus manual timestamp/cue parsing.
3. High-speed lossless splitting for:
   - Multi-stem WAV folders (per-song subfolders or prefixed stems via PCM stream copy)
   - Polyphonic multichannel WAV files (keep multichannel per song or explode into mono stems)
   - Concert videos (lossless stream copy or frame-accurate H.264 re-encode + optional per-song audio extraction)
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

_VENDOR_DIR = Path(__file__).resolve().parent / ".vendor"
if _VENDOR_DIR.is_dir() and str(_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(_VENDOR_DIR))
    os.environ["PYTHONPATH"] = str(_VENDOR_DIR) + (os.pathsep + os.environ.get("PYTHONPATH", "") if os.environ.get("PYTHONPATH") else "")
    local_bin = _VENDOR_DIR / "bin"
    if local_bin.is_dir():
        os.environ["PATH"] = str(local_bin) + os.pathsep + os.environ.get("PATH", "")

import audio_manager
import fs_browser

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".webm", ".ts", ".m4v", ".avi"}
STEM_AUDIO_EXTENSIONS = {".wav", ".wave", ".rf64", ".w64", ".flac", ".aif", ".aiff"}
SPLITTER_FILE_EXTENSIONS = VIDEO_EXTENSIONS | STEM_AUDIO_EXTENSIONS | audio_manager.EXTENSIONS

MAX_SEGMENTS = 200
MAX_TITLE_LEN = 100

# Keywords to auto-prioritize a good reference stem when detecting song boundaries in a multi-stem folder
STEM_PRIORITY_KEYWORDS = (
    "master",
    "mix",
    "lr",
    "main",
    "stereo",
    "foh",
    "board",
    "vox",
    "vocal",
    "lead",
    "snare",
    "snr",
    "oh",
    "overhead",
    "drum",
    "gtr",
    "guitar",
    "keys",
    "piano",
    "music",
)


def format_timestamp(seconds: float) -> str:
    """Formats seconds into HH:MM:SS or MM:SS."""
    sec = max(0.0, float(seconds))
    total_sec = int(round(sec))
    hrs = total_sec // 3600
    mins = (total_sec % 3600) // 60
    rem = total_sec % 60
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{rem:02d}"
    return f"{mins:02d}:{rem:02d}"


def is_youtube_url(url_or_path: str | Path | None) -> bool:
    """Checks if the target is an HTTP/HTTPS YouTube URL."""
    if not url_or_path:
        return False
    clean = str(url_or_path).strip()
    if not clean.startswith(("http://", "https://")):
        return False
    return fs_browser.validate_url(clean)


def fetch_youtube_video_info(url: str, cookies_file: Path | None = None) -> dict:
    """Fetches video title, duration, thumbnail, resolution, embedded chapters, and description timestamps."""
    if not is_youtube_url(url):
        raise ValueError("URL bukan link YouTube yang valid. Pastikan domain youtube.com atau youtu.be.")

    cmd = list(audio_manager.get_ytdlp_base_cmd())
    cmd.extend([
        "--dump-json",
        "--no-download",
        "--no-playlist",
    ])
    if cookies_file and cookies_file.is_file():
        cmd.extend(["--cookies", str(cookies_file)])

    cmd.append(url.strip())
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
    if res.returncode != 0:
        err_msg = res.stderr.strip()[:250] if res.stderr else "Gagal menghubungi YouTube"
        raise RuntimeError(f"Gagal mengambil info YouTube: {err_msg}")

    info = json.loads(res.stdout or "{}")
    vid_id = str(info.get("id") or "")
    title = str(info.get("title") or "Konser YouTube")
    duration_s = float(info.get("duration") or 0.0)
    uploader = str(info.get("uploader") or info.get("channel") or "")
    thumbnail = str(info.get("thumbnail") or "")
    width = info.get("width")
    height = info.get("height")
    resolution = f"{width}x{height}" if (width and height) else str(info.get("resolution") or "")
    description = str(info.get("description") or "")

    raw_chapters = info.get("chapters") or []
    chapters = []
    for idx, ch in enumerate(raw_chapters, 1):
        st = audio_manager.get_float(ch.get("start_time"))
        et = audio_manager.get_float(ch.get("end_time"))
        if st is None or et is None or et <= st:
            continue
        ch_title = sanitize_segment_title(str(ch.get("title") or f"Lagu {idx:02d}"), idx)
        chapters.append({
            "index": idx,
            "title": ch_title,
            "start_s": round(st, 2),
            "end_s": round(et, 2),
            "duration_s": round(et - st, 2),
        })

    desc_segments = []
    if not chapters and description:
        try:
            desc_segments = parse_manual_timestamps(description, duration_s)
        except Exception:
            desc_segments = []

    segments = chapters if chapters else desc_segments
    method = "EMBEDDED_CHAPTERS" if chapters else ("DESCRIPTION_TIMESTAMPS" if desc_segments else "NONE")

    return {
        "id": vid_id,
        "url": url.strip(),
        "title": title,
        "uploader": uploader,
        "thumbnail": thumbnail,
        "duration_s": round(duration_s, 2),
        "duration_label": format_timestamp(duration_s),
        "resolution": resolution,
        "chapters": chapters,
        "chapter_count": len(chapters),
        "description": description,
        "detected_segments": segments,
        "segment_count": len(segments),
        "detection_method": method,
        "detection_note": (
            f"Ditemukan {len(chapters)} chapter resmi dari video YouTube."
            if chapters
            else (
                f"Ditemukan {len(desc_segments)} lagu dari tracklist deskripsi YouTube."
                if desc_segments
                else "Video belum memiliki chapter/tracklist. Gunakan deteksi jeda audio otomatis atau tambah segmen manual."
            )
        ),
    }


def download_youtube_video(
    url: str,
    out_dir: Path,
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
    cookies_file: Path | None = None,
) -> Path:
    """Downloads concert video from YouTube to out_dir, embedding chapters into the MP4 container."""
    if not is_youtube_url(url):
        raise ValueError("URL bukan link YouTube yang valid.")

    out_dir.mkdir(parents=True, exist_ok=True)
    template = str(out_dir / "%(title).150B [%(id)s].%(ext)s")

    cmd = list(audio_manager.get_ytdlp_base_cmd())
    cmd.extend([
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b",
        "--merge-output-format", "mp4",
        "--embed-chapters",
        "--embed-metadata",
        "-o", template,
        "--no-playlist",
    ])
    if cookies_file and cookies_file.is_file():
        cmd.extend(["--cookies", str(cookies_file)])

    cmd.append(url.strip())
    log_fn = on_log or (lambda msg: None)

    log_fn(f"[YOUTUBE VIDEO] Mengunduh video konser dari: {url}")
    before_files = set(out_dir.glob("*.mp4"))

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )
    if proc.stdout:
        for line in proc.stdout:
            clean_line = line.strip()
            if not clean_line:
                continue
            log_fn(clean_line)
            if on_progress is not None:
                m = re.search(r"\[download\]\s+([\d\.]+)%", clean_line)
                if m:
                    try:
                        on_progress(min(99.0, float(m.group(1))))
                    except ValueError:
                        pass

    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"Gagal mengunduh video dari YouTube (kode: {ret})")

    after_files = set(out_dir.glob("*.mp4"))
    new_files = list(after_files - before_files)
    if new_files:
        return new_files[0]

    cand = list(out_dir.glob("*.mp4"))
    if cand:
        return max(cand, key=lambda p: p.stat().st_mtime)

    raise RuntimeError("File video hasil unduhan tidak ditemukan di folder tujuan.")


def format_timestamp_precise(seconds: float) -> str:
    """Formats seconds into HH:MM:SS.d (1 decimal place)."""
    sec = max(0.0, float(seconds))
    hrs = int(sec // 3600)
    mins = int((sec % 3600) // 60)
    rem = sec - (hrs * 3600 + mins * 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{rem:04.1f}"
    return f"{mins:02d}:{rem:04.1f}"


def parse_timestamp_str(raw: str | float | int) -> float | None:
    """Parses 'HH:MM:SS.ms', 'MM:SS', or numeric seconds into float seconds."""
    if isinstance(raw, (int, float)):
        if math.isfinite(raw) and raw >= 0:
            return float(raw)
        return None
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    # Pure number in seconds
    if re.match(r"^\d+(?:\.\d+)?$", s):
        val = float(s)
        return val if math.isfinite(val) and val >= 0 else None

    parts = s.split(":")
    if len(parts) == 2:
        try:
            mins = int(parts[0])
            secs = float(parts[1])
            if mins >= 0 and 0.0 <= secs < 60.0:
                return mins * 60.0 + secs
        except ValueError:
            return None
    elif len(parts) == 3:
        try:
            hrs = int(parts[0])
            mins = int(parts[1])
            secs = float(parts[2])
            if hrs >= 0 and 0 <= mins < 60 and 0.0 <= secs < 60.0:
                return hrs * 3600.0 + mins * 60.0 + secs
        except ValueError:
            return None
    return None


def sanitize_segment_title(raw_title: str, fallback_index: int = 1) -> str:
    """Strictly sanitizes a user-supplied song/segment title for safe filesystem usage."""
    if not isinstance(raw_title, str):
        raw_title = ""
    # Strip path separators, traversal sequences, control characters, and reserved symbols
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", raw_title)
    cleaned = cleaned.replace("..", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
    if not cleaned:
        cleaned = f"Lagu {fallback_index:02d}"
    return cleaned[:MAX_TITLE_LEN].strip()


def validate_safe_file_path(raw_path: str | Path, base_dir: Path | None = None) -> Path:
    """Resolves and validates a file path within allowed roots (no dot-folders or traversal)."""
    cleaned = fs_browser.normalize_windows_or_wsl_path(str(raw_path))
    p = Path(cleaned).expanduser()
    if not p.is_absolute():
        p = (base_dir or fs_browser.INBOX_DIR) / p
    resolved = p.resolve()

    allowed_roots = fs_browser.get_allowed_roots()
    matched_root = next((r for r in allowed_roots if resolved.is_relative_to(r)), None)
    if matched_root is None:
        raise ValueError(f"Akses file ditolak (di luar direktori yang diizinkan): {resolved}")

    rel_parts = resolved.relative_to(matched_root).parts
    if any(part.startswith(".") for part in rel_parts):
        raise ValueError("Tidak diizinkan mengakses file/folder tersembunyi (dot-path).")

    if base_dir is not None and not resolved.is_relative_to(base_dir.resolve()):
        raise ValueError("File berada di luar folder sumber yang dipilih.")

    if not resolved.is_file():
        raise ValueError(f"File tidak ditemukan: {resolved}")
    return resolved


def probe_media_detailed(path: Path) -> dict:
    """Runs ffprobe to inspect audio/video streams, duration, channel count, and chapters."""
    audio_manager.require("ffprobe")
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        str(path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe gagal membaca {path.name}: {res.stderr.strip()[:200]}")

    data = json.loads(res.stdout or "{}")
    streams = data.get("streams", [])
    fmt = data.get("format", {})
    chapters_raw = data.get("chapters", [])

    video_stream = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]
    primary_audio = audio_streams[0] if audio_streams else {}

    duration_s = (
        audio_manager.get_float(fmt.get("duration"))
        or audio_manager.get_float(primary_audio.get("duration"))
        or audio_manager.get_float((video_stream or {}).get("duration"))
        or 0.0
    )
    sample_rate_hz = int(primary_audio.get("sample_rate") or 0)
    channels = int(primary_audio.get("channels") or 0)
    audio_codec = str(primary_audio.get("codec_name") or "")
    video_codec = str((video_stream or {}).get("codec_name") or "")
    width = int((video_stream or {}).get("width") or 0)
    height = int((video_stream or {}).get("height") or 0)
    bitrate_bps = audio_manager.get_float(fmt.get("bit_rate")) or audio_manager.get_float(primary_audio.get("bit_rate")) or 0.0

    ext = path.suffix.lower()
    has_real_video = video_stream is not None and ext in VIDEO_EXTENSIONS

    chapters = []
    for idx, ch in enumerate(chapters_raw, 1):
        st = audio_manager.get_float(ch.get("start_time"))
        et = audio_manager.get_float(ch.get("end_time"))
        if st is None or et is None or et <= st:
            continue
        tags = ch.get("tags") or {}
        ch_title = sanitize_segment_title(str(tags.get("title") or f"Lagu {idx:02d}"), idx)
        chapters.append({
            "index": idx,
            "title": ch_title,
            "start_s": round(st, 2),
            "end_s": round(et, 2),
            "duration_s": round(et - st, 2),
        })

    if has_real_video:
        media_kind = "CONCERT_VIDEO"
    elif channels > 2:
        media_kind = "MULTICHANNEL_WAV"
    else:
        media_kind = "AUDIO_FILE"

    try:
        size_bytes = path.stat().st_size
    except OSError:
        size_bytes = 0

    return {
        "name": path.name,
        "path": str(path),
        "ext": ext,
        "size_mb": round(size_bytes / (1024 * 1024), 2),
        "duration_s": round(duration_s, 2),
        "duration_label": format_timestamp(duration_s),
        "media_kind": media_kind,
        "has_video": has_real_video,
        "video_codec": video_codec,
        "resolution": f"{width}x{height}" if (width and height) else "",
        "audio_codec": audio_codec,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
        "audio_stream_count": len(audio_streams),
        "bitrate_kbps": round(bitrate_bps / 1000.0, 1) if bitrate_bps else 0.0,
        "chapters": chapters,
        "chapter_count": len(chapters),
    }


def _score_reference_stem(fname: str) -> int:
    """Scores a filename to automatically pick the best reference stem for song detection."""
    low = fname.lower()
    for rank, kw in enumerate(STEM_PRIORITY_KEYWORDS):
        if kw in low:
            return 100 - rank
    return 0


def inspect_splitter_directory(source_dir: Path) -> dict:
    """Scans a directory for multi-stem WAV sessions, multichannel WAVs, and concert videos."""
    target_dir = source_dir.resolve()
    if not target_dir.is_dir():
        raise ValueError(f"Folder tidak ditemukan: {target_dir}")

    direct_files: list[Path] = []
    try:
        for entry in sorted(target_dir.iterdir(), key=lambda x: x.name.lower()):
            if entry.name.startswith(".") or not entry.is_file():
                continue
            if entry.suffix.lower() in SPLITTER_FILE_EXTENSIONS:
                direct_files.append(entry)
    except OSError:
        pass

    # Also check immediate subdirectories if root has no direct files or to list available subfolders
    subdirs: list[dict] = []
    try:
        for d in sorted(target_dir.iterdir(), key=lambda x: x.name.lower()):
            if d.name.startswith(".") or d.name.startswith("$") or d.name in fs_browser.SKIP_SYSTEM_DIRS:
                continue
            if d.is_dir():
                wav_cnt = 0
                vid_cnt = 0
                for f in d.iterdir():
                    if f.name.startswith(".") or not f.is_file():
                        continue
                    fext = f.suffix.lower()
                    if fext in STEM_AUDIO_EXTENSIONS:
                        wav_cnt += 1
                    elif fext in VIDEO_EXTENSIONS:
                        vid_cnt += 1
                subdirs.append({
                    "name": d.name,
                    "path": str(d),
                    "rel_path": d.name,
                    "wav_count": wav_cnt,
                    "video_count": vid_cnt,
                })
    except OSError:
        pass

    items: list[dict] = []
    stem_candidates: list[dict] = []

    for fpath in direct_files:
        try:
            stat = fpath.stat()
        except OSError:
            continue
        ext = fpath.suffix.lower()
        is_video = ext in VIDEO_EXTENSIONS
        is_stem_ext = ext in STEM_AUDIO_EXTENSIONS
        item = {
            "name": fpath.name,
            "rel_path": fpath.name,
            "path": str(fpath),
            "ext": ext,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "is_video": is_video,
            "is_stem_capable": is_stem_ext,
            "stem_score": _score_reference_stem(fpath.name) if is_stem_ext else 0,
        }
        items.append(item)
        if is_stem_ext:
            stem_candidates.append(item)

    # Sort stem candidates to suggest best reference track
    recommended_ref = None
    if stem_candidates:
        best = max(stem_candidates, key=lambda x: (x["stem_score"], x["size_mb"]))
        recommended_ref = best["rel_path"]

    return {
        "source_dir": str(target_dir),
        "folder_name": target_dir.name,
        "files": items,
        "stem_files": stem_candidates,
        "stem_count": len(stem_candidates),
        "is_multistem_folder": len(stem_candidates) >= 2,
        "recommended_reference_stem": recommended_ref,
        "subdirs": subdirs,
    }


def parse_manual_timestamps(raw_text: str, total_duration_s: float) -> list[dict]:
    """Parses user-provided timestamp lines into structured song segments.

    Supports formats like:
    - '00:00 Intro / Lagu 1'
    - '00:00 - 04:32 Lagu 1'
    - '04:32 - Lagu 2'
    - '1. 09:15 Judul Lagu'
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise ValueError("Daftar timestamp manual masih kosong.")

    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    parsed_points: list[tuple[float, float | None, str]] = []

    time_token_re = r"(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)"
    range_pattern = re.compile(
        rf"^(?:\d+[\.\)\-]\s*)?{time_token_re}\s*(?:[-–—~]|s/d|to)\s*{time_token_re}\s*[-–—:\|]?\s*(.*)$",
        re.IGNORECASE,
    )
    single_pattern = re.compile(
        rf"^(?:\d+[\.\)\-]\s*)?{time_token_re}\s*[-–—:\|]?\s*(.*)$"
    )
    trailing_pattern = re.compile(
        rf"^(.*?)\s*[-–—:\|\(]\s*{time_token_re}\)?$"
    )

    for idx, line in enumerate(lines, 1):
        m_range = range_pattern.match(line)
        if m_range:
            st = parse_timestamp_str(m_range.group(1))
            et = parse_timestamp_str(m_range.group(2))
            title = sanitize_segment_title(m_range.group(3), idx)
            if st is not None and et is not None and et > st:
                parsed_points.append((st, et, title))
                continue

        m_single = single_pattern.match(line)
        if m_single:
            st = parse_timestamp_str(m_single.group(1))
            title = sanitize_segment_title(m_single.group(2), idx)
            if st is not None:
                parsed_points.append((st, None, title))
                continue

        m_trail = trailing_pattern.match(line)
        if m_trail:
            title = sanitize_segment_title(m_trail.group(1), idx)
            st = parse_timestamp_str(m_trail.group(2))
            if st is not None:
                parsed_points.append((st, None, title))
                continue

    if not parsed_points:
        raise ValueError(
            "Format timestamp tidak dikenali. Gunakan format seperti '00:00 Lagu 1' atau '00:00 - 04:30 Lagu 1' per baris."
        )

    parsed_points.sort(key=lambda x: x[0])
    segments: list[dict] = []
    max_dur = max(total_duration_s, parsed_points[-1][1] or (parsed_points[-1][0] + 60.0))

    for i, (st, explicit_et, title) in enumerate(parsed_points):
        if st >= max_dur and total_duration_s > 0:
            continue
        if explicit_et is not None:
            et = min(explicit_et, max_dur) if total_duration_s > 0 else explicit_et
        elif i + 1 < len(parsed_points):
            et = parsed_points[i + 1][0]
        else:
            et = max_dur
        if et <= st:
            continue
        seg_idx = len(segments) + 1
        segments.append({
            "index": seg_idx,
            "title": sanitize_segment_title(title, seg_idx),
            "start_s": round(st, 2),
            "end_s": round(et, 2),
            "duration_s": round(et - st, 2),
        })

    if not segments:
        raise ValueError("Tidak ada rentang waktu lagu yang valid dalam batas durasi file.")
    return segments[:MAX_SEGMENTS]


def _run_ffmpeg_silencedetect(
    input_path: Path,
    noise_db: float,
    min_silence_s: float,
    channel_mode: str = "auto",
) -> list[tuple[float, float]]:
    """Runs FFmpeg silencedetect with musical bandpass filtering and returns [(silence_start, silence_end), ...]."""
    audio_manager.require("ffmpeg")
    noise_db = max(-80.0, min(-5.0, float(noise_db)))
    min_silence_s = max(0.3, min(60.0, float(min_silence_s)))

    filters: list[str] = []
    # If specific channel pair or channel index is requested on multichannel files
    if channel_mode == "ch1_2":
        filters.append("pan=mono|c0=0.5*c0+0.5*c1")
    elif channel_mode.startswith("ch") and channel_mode[2:].isdigit():
        ch_idx = max(0, int(channel_mode[2:]) - 1)
        filters.append(f"pan=mono|c0=c{ch_idx}")

    # Musical bandpass (80Hz - 6000Hz) removes sub-rumble/hum & high hiss between songs
    filters.append("highpass=f=80")
    filters.append("lowpass=f=6000")
    filters.append(f"silencedetect=noise={noise_db:.1f}dB:d={min_silence_s:.2f}")

    af_chain = ",".join(filters)
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-vn",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "8000",
        "-af",
        af_chain,
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    stderr_text = proc.stderr or ""

    silences: list[tuple[float, float]] = []
    curr_start: float | None = None

    start_re = re.compile(r"silence_start:\s*([0-9\.]+)")
    end_re = re.compile(r"silence_end:\s*([0-9\.]+)")

    for line in stderr_text.splitlines():
        if "silence_start:" in line:
            m = start_re.search(line)
            if m:
                try:
                    curr_start = float(m.group(1))
                except ValueError:
                    curr_start = None
        elif "silence_end:" in line:
            m = end_re.search(line)
            if m and curr_start is not None:
                try:
                    s_end = float(m.group(1))
                    if s_end > curr_start:
                        silences.append((curr_start, s_end))
                except ValueError:
                    pass
                curr_start = None

    return silences


def _detect_rms_energy_valleys(
    input_path: Path,
    total_duration_s: float,
    min_silence_s: float,
    min_song_s: float,
) -> tuple[list[tuple[float, float]], float]:
    """Adaptive RMS energy valley detector for loud concerts where crowd noise prevents fixed silence detection.

    Measures 1-second RMS windows via FFmpeg astats and identifies sustained energy drops between songs.
    Returns (list of (valley_start, valley_end), effective_threshold_db).
    """
    audio_manager.require("ffmpeg")
    # 4000 Hz mono with 4000 samples per frame = 1 frame per second
    af_chain = "highpass=f=90,lowpass=f=5500,asetnsamples=n=4000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-"
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-vn",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "4000",
        "-af",
        af_chain,
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    stdout_text = proc.stdout or ""

    rms_by_sec: list[tuple[float, float]] = []
    curr_pts = 0.0
    pts_re = re.compile(r"pts_time:([0-9\.]+)")
    rms_re = re.compile(r"lavfi\.astats\.Overall\.RMS_level=([-\d\.]+|[-]inf)")

    for line in stdout_text.splitlines():
        m_pts = pts_re.search(line)
        if m_pts:
            try:
                curr_pts = float(m_pts.group(1))
            except ValueError:
                pass
            continue
        m_rms = rms_re.search(line)
        if m_rms:
            val_str = m_rms.group(1)
            if "inf" in val_str:
                rms_val = -90.0
            else:
                try:
                    rms_val = float(val_str)
                except ValueError:
                    rms_val = -90.0
            rms_by_sec.append((curr_pts, rms_val))

    if len(rms_by_sec) < 10:
        return [], -35.0

    # Compute percentiles of active musical energy
    valid_levels = sorted(v for _, v in rms_by_sec if v > -80.0)
    if not valid_levels:
        return [], -35.0

    p75 = valid_levels[int(len(valid_levels) * 0.75)]
    p20 = valid_levels[int(len(valid_levels) * 0.20)]
    # Adaptive threshold sits between the 20th percentile and (75th percentile - 10 dB)
    adaptive_thresh = max(p20 + 1.5, min(p75 - 8.5, -18.0))

    valleys: list[tuple[float, float]] = []
    in_valley = False
    v_start = 0.0
    v_last = 0.0
    min_gap = max(2.0, float(min_silence_s))

    for t_sec, lvl in rms_by_sec:
        if lvl <= adaptive_thresh:
            if not in_valley:
                in_valley = True
                v_start = t_sec
            v_last = t_sec + 1.0
        else:
            if in_valley:
                if (v_last - v_start) >= min_gap:
                    valleys.append((v_start, v_last))
                in_valley = False

    if in_valley and (v_last - v_start) >= min_gap:
        valleys.append((v_start, min(total_duration_s, v_last)))

    return valleys, round(adaptive_thresh, 1)


def _silences_to_song_segments(
    silences: list[tuple[float, float]],
    total_duration_s: float,
    min_song_s: float = 60.0,
    pad_before_s: float = 0.5,
    pad_after_s: float = 1.0,
    trim_silence_edges: bool = True,
) -> list[dict]:
    """Converts detected silence/energy-drop intervals into clean song segments.

    Merges short pauses (< min_song_s) so mid-song breaks do not falsely split a song.
    """
    if total_duration_s <= 0:
        return []

    min_song_s = max(5.0, float(min_song_s))
    pad_before_s = max(0.0, min(10.0, float(pad_before_s)))
    pad_after_s = max(0.0, min(10.0, float(pad_after_s)))

    # Sort and merge overlapping/adjacent silence intervals
    sorted_sil = sorted((max(0.0, s), min(total_duration_s, e)) for s, e in silences if e > s)
    merged_sil: list[tuple[float, float]] = []
    for s, e in sorted_sil:
        if merged_sil and s - merged_sil[-1][1] <= 1.0:
            merged_sil[-1] = (merged_sil[-1][0], max(merged_sil[-1][1], e))
        else:
            merged_sil.append((s, e))

    # Build raw active regions between silence intervals
    raw_regions: list[tuple[float, float]] = []
    cursor = 0.0
    for s_start, s_end in merged_sil:
        if s_start > cursor + 0.5:
            raw_regions.append((cursor, s_start))
        cursor = s_end
    if total_duration_s > cursor + 0.5:
        raw_regions.append((cursor, total_duration_s))

    if not raw_regions:
        return [{
            "index": 1,
            "title": "Lagu 01",
            "start_s": 0.0,
            "end_s": round(total_duration_s, 2),
            "duration_s": round(total_duration_s, 2),
        }]

    # Merge regions shorter than min_song_s with neighbor so brief mid-song pauses don't split a song
    consolidated: list[list[float]] = [[raw_regions[0][0], raw_regions[0][1]]]
    for r_start, r_end in raw_regions[1:]:
        prev_start, prev_end = consolidated[-1]
        prev_dur = prev_end - prev_start
        curr_dur = r_end - r_start
        if prev_dur < min_song_s:
            # Previous segment was too short (e.g. intro speech or false pause); merge into current
            consolidated[-1][1] = r_end
        elif curr_dur < min_song_s:
            # Current segment is too short; merge into previous song
            consolidated[-1][1] = r_end
        else:
            consolidated.append([r_start, r_end])

    # Apply natural padding at boundaries without overlapping adjacent songs
    segments: list[dict] = []
    total_segs = min(len(consolidated), MAX_SEGMENTS)
    for i in range(total_segs):
        raw_st, raw_et = consolidated[i]
        if trim_silence_edges:
            prev_limit = consolidated[i - 1][1] if i > 0 else 0.0
            next_limit = consolidated[i + 1][0] if i + 1 < total_segs else total_duration_s
            st = max(prev_limit, raw_st - pad_before_s)
            et = min(next_limit, raw_et + pad_after_s)
            if i > 0 and segments:
                # Ensure no overlap with previous padded end
                st = max(st, segments[-1]["end_s"])
        else:
            # Continuous split at midpoints of silence gaps
            st = 0.0 if i == 0 else segments[-1]["end_s"]
            if i + 1 < total_segs:
                et = round((raw_et + consolidated[i + 1][0]) / 2.0, 2)
            else:
                et = total_duration_s

        if et <= st:
            continue

        idx = len(segments) + 1
        segments.append({
            "index": idx,
            "title": f"Lagu {idx:02d}",
            "start_s": round(st, 2),
            "end_s": round(et, 2),
            "duration_s": round(et - st, 2),
        })

    return segments


def detect_song_segments(
    target_path: Path | str,
    mode: str = "auto",
    noise_db: float = -32.0,
    min_silence_s: float = 2.5,
    min_song_s: float = 60.0,
    pad_before_s: float = 0.5,
    pad_after_s: float = 1.0,
    trim_silence_edges: bool = True,
    reference_stem: str | None = None,
    channel_mode: str = "auto",
    manual_timestamps: str | None = None,
) -> dict:
    """Detects song segments on a concert video, multichannel WAV, multi-stem WAV folder, or YouTube URL.

    Returns metadata + detected segments list ready for preview/editing in UI or immediate CLI execution.
    """
    if is_youtube_url(target_path):
        url_str = str(target_path).strip()
        yt_info = fetch_youtube_video_info(url_str)
        dur = yt_info["duration_s"]
        if manual_timestamps and manual_timestamps.strip():
            segs = parse_manual_timestamps(manual_timestamps, dur)
            method = "MANUAL_TIMESTAMPS"
            note = f"Berhasil memuat {len(segs)} lagu dari timestamp manual untuk video YouTube."
        elif yt_info.get("detected_segments"):
            segs = yt_info["detected_segments"]
            method = yt_info["detection_method"]
            note = yt_info["detection_note"]
        else:
            segs = [{
                "index": 1,
                "title": sanitize_segment_title(yt_info["title"], 1),
                "start_s": 0.0,
                "end_s": round(dur, 2),
                "duration_s": round(dur, 2),
            }]
            method = "FULL_VIDEO"
            note = "Video YouTube siap dipotong. Anda dapat memasukkan timestamp manual di bawah atau memotongnya."

        return {
            "target_type": "youtube_video",
            "target_name": yt_info["title"],
            "target_path": url_str,
            "reference_file": yt_info["title"],
            "duration_s": dur,
            "duration_label": yt_info["duration_label"],
            "resolution": yt_info["resolution"],
            "uploader": yt_info["uploader"],
            "thumbnail": yt_info["thumbnail"],
            "youtube_info": yt_info,
            "chapters": yt_info.get("chapters", []),
            "detection_method": method,
            "detection_note": note,
            "segments": segs,
        }

    resolved = Path(target_path).resolve()
    analysis_file: Path
    target_summary: dict

    if resolved.is_dir():
        dir_info = inspect_splitter_directory(resolved)
        stem_files = dir_info.get("stem_files", [])
        if not stem_files:
            raise ValueError("Folder ini tidak memiliki file WAV/FLAC/AIFF untuk dianalisis.")

        chosen_rel = reference_stem or dir_info.get("recommended_reference_stem") or stem_files[0]["rel_path"]
        cand_path = (resolved / str(chosen_rel)).resolve()
        if not cand_path.is_relative_to(resolved) or not cand_path.is_file():
            cand_path = Path(stem_files[0]["path"]).resolve()
        analysis_file = cand_path
        probe_info = probe_media_detailed(analysis_file)
        target_summary = {
            "target_type": "folder_stems",
            "target_name": resolved.name,
            "target_path": str(resolved),
            "reference_file": analysis_file.name,
            "stem_count": len(stem_files),
            "duration_s": probe_info["duration_s"],
            "duration_label": probe_info["duration_label"],
            "sample_rate_hz": probe_info["sample_rate_hz"],
            "channels_per_stem": probe_info["channels"],
            "audio_codec": probe_info["audio_codec"],
            "chapters": probe_info["chapters"],
        }
    elif resolved.is_file():
        analysis_file = resolved
        probe_info = probe_media_detailed(analysis_file)
        target_type = (
            "concert_video"
            if probe_info["has_video"]
            else ("multichannel_wav" if probe_info["channels"] > 2 else "single_audio")
        )
        target_summary = {
            "target_type": target_type,
            "target_name": analysis_file.name,
            "target_path": str(analysis_file),
            "reference_file": analysis_file.name,
            "stem_count": 1,
            "duration_s": probe_info["duration_s"],
            "duration_label": probe_info["duration_label"],
            "sample_rate_hz": probe_info["sample_rate_hz"],
            "channels": probe_info["channels"],
            "audio_codec": probe_info["audio_codec"],
            "video_codec": probe_info["video_codec"],
            "resolution": probe_info["resolution"],
            "chapters": probe_info["chapters"],
        }
    else:
        raise ValueError(f"Target tidak ditemukan: {resolved}")

    total_dur = float(target_summary.get("duration_s") or 0.0)
    if total_dur <= 0:
        raise RuntimeError("Tidak dapat membaca durasi audio/video dari file target.")

    clean_mode = str(mode or "auto").strip().lower()

    # 1. Manual timestamp list mode
    if clean_mode == "manual" or (manual_timestamps and manual_timestamps.strip()):
        segments = parse_manual_timestamps(manual_timestamps or "", total_dur)
        return {
            **target_summary,
            "detection_method": "MANUAL_TIMESTAMPS",
            "detection_note": f"Berhasil memuat {len(segments)} segmen lagu dari daftar timestamp manual.",
            "segments": segments,
        }

    # 2. Embedded chapters mode (if requested or available in auto mode when > 1 chapter)
    chapters = target_summary.get("chapters") or []
    if clean_mode == "chapters" or (clean_mode == "auto" and len(chapters) >= 2):
        if not chapters:
            raise ValueError("File ini tidak memiliki metadata Chapter bawaan. Gunakan mode Deteksi Audio Otomatis.")
        return {
            **target_summary,
            "detection_method": "EMBEDDED_CHAPTERS",
            "detection_note": f"Ditemukan {len(chapters)} Chapter bawaan di dalam metadata file.",
            "segments": chapters[:MAX_SEGMENTS],
        }

    # 3. Acoustic Silence / Energy Drop Detection
    silences = _run_ffmpeg_silencedetect(
        analysis_file,
        noise_db=noise_db,
        min_silence_s=min_silence_s,
        channel_mode=channel_mode,
    )
    segments = _silences_to_song_segments(
        silences,
        total_duration_s=total_dur,
        min_song_s=min_song_s,
        pad_before_s=pad_before_s,
        pad_after_s=pad_after_s,
        trim_silence_edges=trim_silence_edges,
    )

    method_used = "SILENCE_DETECT"
    effective_db = noise_db

    # If fixed dB threshold only yielded 1 giant segment on a long recording (> 2.5x min_song_s),
    # automatically run the Adaptive RMS Energy Valley detector for noisy live concerts!
    if (len(segments) <= 1 and total_dur >= max(120.0, min_song_s * 2.2)) or clean_mode == "adaptive":
        valleys, adaptive_db = _detect_rms_energy_valleys(
            analysis_file,
            total_duration_s=total_dur,
            min_silence_s=min_silence_s,
            min_song_s=min_song_s,
        )
        if valleys:
            adaptive_segs = _silences_to_song_segments(
                valleys,
                total_duration_s=total_dur,
                min_song_s=min_song_s,
                pad_before_s=pad_before_s,
                pad_after_s=pad_after_s,
                trim_silence_edges=trim_silence_edges,
            )
            if len(adaptive_segs) > len(segments):
                segments = adaptive_segs
                silences = valleys
                method_used = "ADAPTIVE_RMS_VALLEY"
                effective_db = adaptive_db

    if len(segments) <= 1:
        note = (
            f"Analisis selesai (ref: {analysis_file.name}), namun hanya terdeteksi 1 bagian utuh. "
            f"Coba naikkan ambang dB (misal -24 dB untuk konser ramai) atau kurangi Durasi Lagu Minimum."
        )
    else:
        note = (
            f"Berhasil mendeteksi {len(segments)} bagian lagu dari '{analysis_file.name}' "
            f"(metode: {method_used}, ambang: {effective_db} dB, jeda >= {min_silence_s}s)."
        )

    return {
        **target_summary,
        "detection_method": method_used,
        "effective_noise_db": effective_db,
        "raw_silence_count": len(silences),
        "detection_note": note,
        "segments": segments,
    }


def validate_and_normalize_segments(raw_segments: list[dict], max_duration_s: float | None = None) -> list[dict]:
    """Validates user-edited segment list before executing FFmpeg split tasks."""
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("Daftar segmen lagu kosong. Lakukan deteksi otomatis atau tambah baris segmen terlebih dahulu.")
    if len(raw_segments) > MAX_SEGMENTS:
        raise ValueError(f"Jumlah segmen melebihi batas maksimum ({MAX_SEGMENTS} lagu).")

    validated: list[dict] = []
    upper_bound = (float(max_duration_s) + 60.0) if (max_duration_s and max_duration_s > 0) else 86400.0 * 2

    for idx, item in enumerate(raw_segments, 1):
        if not isinstance(item, dict):
            continue
        if item.get("enabled") is False:
            continue

        st = parse_timestamp_str(item.get("start_s", item.get("start")))
        et = parse_timestamp_str(item.get("end_s", item.get("end")))
        if st is None or et is None:
            raise ValueError(f"Segmen #{idx}: Waktu Mulai atau Selesai tidak valid.")
        if st < 0 or et <= st:
            raise ValueError(f"Segmen #{idx}: Waktu Selesai ({et}s) harus lebih besar dari Waktu Mulai ({st}s).")
        if et > upper_bound:
            raise ValueError(f"Segmen #{idx}: Waktu Selesai melebihi durasi file.")

        title = sanitize_segment_title(str(item.get("title") or f"Lagu {idx:02d}"), len(validated) + 1)
        validated.append({
            "index": len(validated) + 1,
            "title": title,
            "start_s": round(st, 3),
            "end_s": round(et, 3),
            "duration_s": round(et - st, 3),
        })

    if not validated:
        raise ValueError("Tidak ada segmen aktif yang dipilih untuk dipotong.")
    return validated


def _extract_audio_from_segment(
    source_file: Path,
    start_s: float,
    end_s: float,
    out_audio_base: Path,
    audio_fmt: str,
    title: str,
    track_num: int,
) -> Path:
    """Extracts an audio file per song from a video or audio source."""
    fmt = audio_fmt.lower().strip()
    if fmt == "wav":
        out_path = out_audio_base.with_suffix(".wav")
        codec_args = ["-c:a", "pcm_s24le"]
    elif fmt == "flac":
        out_path = out_audio_base.with_suffix(".flac")
        codec_args = ["-c:a", "flac"]
    elif fmt == "opus":
        out_path = out_audio_base.with_suffix(".opus")
        codec_args = ["-c:a", "libopus", "-b:a", "256k"]
    else:  # default mp3_320k
        out_path = out_audio_base.with_suffix(".mp3")
        codec_args = ["-c:a", "libmp3lame", "-b:a", "320k", "-write_xing", "0", "-id3v2_version", "3"]

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-nostats",
        "-ss",
        f"{start_s:.3f}",
        "-to",
        f"{end_s:.3f}",
        "-i",
        str(source_file),
        "-vn",
        "-map",
        "0:a:0",
        *codec_args,
        "-metadata",
        f"title={title}",
        "-metadata",
        f"track={track_num}",
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Gagal ekstrak audio {out_path.name}: {proc.stderr[-250:].strip()}")
    return out_path


def execute_split_job(
    target_path: Path | str,
    segments: list[dict],
    out_dir: Path | None = None,
    split_mode: str = "auto",
    video_cut_mode: str = "copy",
    extract_audio_fmt: str = "none",
    multichannel_mode: str = "keep_multichannel",
    stem_org_mode: str = "folder_per_song",
    on_log: Callable[[str], None] | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> dict:
    """Executes the splitting job across Multi-Stem WAV folders, Multichannel WAVs, Concert Videos, or YouTube URLs."""
    audio_manager.require("ffmpeg")
    audio_manager.require("ffprobe")

    log_fn = on_log or (lambda msg: print(msg, flush=True))
    prog_fn = on_progress or (lambda pct: None)

    is_yt = is_youtube_url(target_path)
    if is_yt:
        url_str = str(target_path).strip()
        log_fn(f"[YOUTUBE CONCERT] Memproses video konser langsung dari YouTube: {url_str}")
        cwd = Path(os.getcwd()).resolve()

        if out_dir is not None:
            dest_root = out_dir.resolve()
            yt_source_dir = dest_root / "_source_concert"
        else:
            dest_root = None
            yt_source_dir = cwd / "output" / "YouTube_Concerts" / "_source_concert"

        yt_source_dir.mkdir(parents=True, exist_ok=True)
        log_fn(f"[YOUTUBE CONCERT] Mengunduh file video konser ke: {yt_source_dir}...")

        def _yt_dl_prog(pct: float) -> None:
            prog_fn(min(45.0, round(pct * 0.45, 1)))

        resolved_target = download_youtube_video(
            url_str,
            yt_source_dir,
            on_log=log_fn,
            on_progress=_yt_dl_prog,
        )
        log_fn(f"[YOUTUBE CONCERT] Unduhan video selesai: '{resolved_target.name}'")

        if dest_root is None:
            dest_root = cwd / "output" / "YouTube_Concerts" / f"{resolved_target.stem} [Split Per Lagu]"
        dest_root.mkdir(parents=True, exist_ok=True)

        if not segments:
            log_fn("[YOUTUBE CONCERT] Segmen tidak disediakan, menganalisis chapter video...")
            detected = detect_song_segments(resolved_target)
            segments = detected.get("segments", [])
    else:
        resolved_target = Path(target_path).resolve()
        # Determine output base directory
        if resolved_target.is_dir():
            default_base = resolved_target.parent / f"{resolved_target.name} [Split Per Lagu]"
        else:
            default_base = resolved_target.parent / f"{resolved_target.stem} [Split Per Lagu]"

        dest_root = (out_dir.resolve() if out_dir is not None else default_base.resolve())
        dest_root.mkdir(parents=True, exist_ok=True)

    validated_segs = validate_and_normalize_segments(segments)
    total_segs = len(validated_segs)

    # Determine target category
    if resolved_target.is_dir() or split_mode == "folder_stems":
        if not resolved_target.is_dir():
            raise ValueError("Mode Folder Multi-Stem membutuhkan path berupa direktori.")
        dir_info = inspect_splitter_directory(resolved_target)
        stem_items = dir_info.get("stem_files", [])
        if not stem_items:
            raise ValueError("Tidak ditemukan file WAV/FLAC/AIFF di dalam folder sumber.")

        stem_paths = [Path(s["path"]).resolve() for s in stem_items]
        total_ops = total_segs * len(stem_paths)
        done_ops = 0
        created_files = 0
        errors = 0

        log_fn(
            f"[MULTITRACK STEM SPLIT] Memotong {len(stem_paths)} stem track menjadi {total_segs} lagu "
            f"-> {dest_root}"
        )

        for seg in validated_segs:
            idx = seg["index"]
            title = seg["title"]
            st = seg["start_s"]
            et = seg["end_s"]
            folder_label = f"{idx:02d} - {title}"

            if stem_org_mode == "prefix_per_song":
                song_dir = dest_root
            else:
                song_dir = dest_root / folder_label
                song_dir.mkdir(parents=True, exist_ok=True)

            log_fn(
                f"▶ Lagu {idx:02d}/{total_segs}: '{title}' "
                f"[{format_timestamp(st)} -> {format_timestamp(et)} | {seg['duration_s']:.1f}s] ({len(stem_paths)} stem)"
            )

            for sp in stem_paths:
                ext = sp.suffix
                if stem_org_mode == "prefix_per_song":
                    out_file = song_dir / f"{folder_label} - {sp.name}"
                else:
                    out_file = song_dir / sp.name

                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-nostats",
                    "-ss",
                    f"{st:.3f}",
                    "-to",
                    f"{et:.3f}",
                    "-i",
                    str(sp),
                    "-map",
                    "0:a:0",
                    "-c:a",
                    "copy",
                ]
                if ext.lower() in (".wav", ".wave", ".rf64"):
                    cmd.extend(["-rf64", "auto"])
                cmd.append(str(out_file))

                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    errors += 1
                    log_fn(f"  ✗ ERROR stem {sp.name}: {proc.stderr[-200:].strip()}")
                else:
                    created_files += 1

                done_ops += 1
                prog_fn(min(99.0, round((done_ops / max(1, total_ops)) * 100.0, 1)))

        prog_fn(100.0)
        return {
            "status": "SUCCESS" if errors == 0 else ("PARTIAL" if created_files > 0 else "FAILED"),
            "target_type": "folder_stems",
            "out_dir": str(dest_root),
            "songs_count": total_segs,
            "stems_per_song": len(stem_paths),
            "created_files": created_files,
            "errors": errors,
        }

    # Single file: either Concert Video, Multichannel WAV, or Single Audio File
    probe = probe_media_detailed(resolved_target)
    has_video = bool(probe.get("has_video"))
    channels = int(probe.get("channels") or 2)
    audio_codec = str(probe.get("audio_codec") or "pcm_s24le")
    ext = resolved_target.suffix

    if has_video:
        is_reencode = (str(video_cut_mode).lower() == "reencode")
        want_audio = str(extract_audio_fmt or "none").lower() not in ("none", "", "off")
        audio_subdir = dest_root / "Audio_Per_Lagu" if want_audio else None
        if audio_subdir:
            audio_subdir.mkdir(parents=True, exist_ok=True)

        mode_label = "Frame-Accurate H.264 Re-encode" if is_reencode else "Lossless Stream Copy (-c copy)"
        log_fn(
            f"[CONCERT VIDEO SPLIT] Memotong '{resolved_target.name}' menjadi {total_segs} video lagu "
            f"[{mode_label}] -> {dest_root}"
        )

        created_files = 0
        errors = 0
        for i, seg in enumerate(validated_segs, 1):
            idx = seg["index"]
            title = seg["title"]
            st = seg["start_s"]
            et = seg["end_s"]
            file_stem = f"{idx:02d} - {title}"
            out_video = dest_root / f"{file_stem}{ext}"

            log_fn(
                f"▶ [{i}/{total_segs}] Memotong Video: '{out_video.name}' "
                f"({format_timestamp(st)} -> {format_timestamp(et)}, durasi {seg['duration_s']:.1f}s)"
            )

            if is_reencode:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-nostats",
                    "-ss",
                    f"{st:.3f}",
                    "-to",
                    f"{et:.3f}",
                    "-i",
                    str(resolved_target),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "256k",
                    "-metadata",
                    f"title={title}",
                    "-metadata",
                    f"track={idx}",
                    str(out_video),
                ]
            else:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-nostats",
                    "-ss",
                    f"{st:.3f}",
                    "-to",
                    f"{et:.3f}",
                    "-i",
                    str(resolved_target),
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a:0?",
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    "-metadata",
                    f"title={title}",
                    "-metadata",
                    f"track={idx}",
                    str(out_video),
                ]

            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                errors += 1
                log_fn(f"  ✗ ERROR video '{out_video.name}': {proc.stderr[-250:].strip()}")
            else:
                created_files += 1

            if want_audio and audio_subdir is not None:
                try:
                    aud_out = _extract_audio_from_segment(
                        resolved_target,
                        st,
                        et,
                        audio_subdir / file_stem,
                        extract_audio_fmt,
                        title,
                        idx,
                    )
                    created_files += 1
                    log_fn(f"  ♪ Audio diekstrak: Audio_Per_Lagu/{aud_out.name}")
                except Exception as aud_exc:
                    errors += 1
                    log_fn(f"  ✗ ERROR ekstrak audio: {aud_exc}")

            base_prog = 45.0 if is_yt else 0.0
            step_prog = (i / max(1, total_segs)) * (100.0 - base_prog)
            prog_fn(min(99.0, round(base_prog + step_prog, 1)))

        prog_fn(100.0)
        return {
            "status": "SUCCESS" if errors == 0 else ("PARTIAL" if created_files > 0 else "FAILED"),
            "target_type": "concert_video",
            "out_dir": str(dest_root),
            "songs_count": total_segs,
            "created_files": created_files,
            "errors": errors,
        }

    # Multichannel WAV or Single Long Audio File
    explode_mono = (str(multichannel_mode).lower() == "explode_mono_stems" and channels > 1)
    pcm_codec = audio_codec if audio_codec.startswith("pcm_") else "pcm_s24le"

    if explode_mono:
        log_fn(
            f"[MULTICHANNEL DE-INTERLEAVE SPLIT] Memotong & memecah '{resolved_target.name}' ({channels} channel) "
            f"menjadi {total_segs} folder lagu berisi {channels} file mono WAV -> {dest_root}"
        )
    else:
        log_fn(
            f"[AUDIO / MULTICHANNEL SPLIT] Memotong '{resolved_target.name}' ({channels} channel) "
            f"menjadi {total_segs} file lagu (Stream Copy) -> {dest_root}"
        )

    created_files = 0
    errors = 0

    for i, seg in enumerate(validated_segs, 1):
        idx = seg["index"]
        title = seg["title"]
        st = seg["start_s"]
        et = seg["end_s"]
        file_stem = f"{idx:02d} - {title}"

        if explode_mono:
            song_dir = dest_root / file_stem
            song_dir.mkdir(parents=True, exist_ok=True)
            log_fn(
                f"▶ [{i}/{total_segs}] Lagu '{file_stem}' ({format_timestamp(st)} -> {format_timestamp(et)}) "
                f"-> memecah {channels} channel mono WAV..."
            )
            # Process in batches of up to 16 channels per FFmpeg call to keep command length and file descriptors safe
            batch_size = 16
            for batch_start in range(0, channels, batch_size):
                batch_end = min(channels, batch_start + batch_size)
                filter_parts = []
                map_args = []
                for ch_idx in range(batch_start, batch_end):
                    out_label = f"ch{ch_idx + 1}"
                    filter_parts.append(f"[0:a:0]pan=mono|c0=c{ch_idx}[{out_label}]")
                    out_ch_file = song_dir / f"Ch{ch_idx + 1:02d}.wav"
                    map_args.extend(["-map", f"[{out_label}]", "-c:a", pcm_codec, str(out_ch_file)])

                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-nostats",
                    "-ss",
                    f"{st:.3f}",
                    "-to",
                    f"{et:.3f}",
                    "-i",
                    str(resolved_target),
                    "-filter_complex",
                    ";".join(filter_parts),
                    *map_args,
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True)
                if proc.returncode != 0:
                    errors += 1
                    log_fn(f"  ✗ ERROR pecah channel {batch_start + 1}..{batch_end}: {proc.stderr[-250:].strip()}")
                else:
                    created_files += (batch_end - batch_start)
        else:
            out_audio = dest_root / f"{file_stem}{ext}"
            log_fn(
                f"▶ [{i}/{total_segs}] Memotong '{out_audio.name}' "
                f"({format_timestamp(st)} -> {format_timestamp(et)}, {seg['duration_s']:.1f}s)"
            )
            cmd = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-nostats",
                "-ss",
                f"{st:.3f}",
                "-to",
                f"{et:.3f}",
                "-i",
                str(resolved_target),
                "-map",
                "0:a:0",
                "-c:a",
                "copy",
                "-metadata",
                f"title={title}",
                "-metadata",
                f"track={idx}",
            ]
            if ext.lower() in (".wav", ".wave", ".rf64"):
                cmd.extend(["-rf64", "auto"])
            cmd.append(str(out_audio))

            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                errors += 1
                log_fn(f"  ✗ ERROR '{out_audio.name}': {proc.stderr[-250:].strip()}")
            else:
                created_files += 1

        prog_fn(min(99.0, round((i / max(1, total_segs)) * 100.0, 1)))

    prog_fn(100.0)
    return {
        "status": "SUCCESS" if errors == 0 else ("PARTIAL" if created_files > 0 else "FAILED"),
        "target_type": "multichannel_wav" if channels > 2 else "single_audio",
        "out_dir": str(dest_root),
        "songs_count": total_segs,
        "channels": channels,
        "created_files": created_files,
        "errors": errors,
    }

