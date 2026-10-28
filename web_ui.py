#!/usr/bin/env python3
"""Audio Library Web UI: Localhost Server for Batch Ingestion & QC Monitoring.

Designed for audio engineers and programmers.
Listens strictly on 127.0.0.1 for maximum local security.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Import existing audit and helper functions from audio_manager
import audio_manager

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INBOX_DIR = BASE_DIR / "library" / "inbox"
ARCHIVE_FILE = BASE_DIR / "library" / "downloaded_ids.txt"
COOKIES_FILE = BASE_DIR / "library" / "cookies.txt"

# In-memory queue state
queue_lock = threading.Lock()
task_queue: list[dict] = []
current_task: dict | None = None
task_history: list[dict] = []
cached_qc_results: dict[str, dict] = {}
cached_meta_results: dict[str, dict] = {}


SKIP_SYSTEM_DIRS = {
    "$Recycle.Bin",
    "$WinREAgent",
    "System Volume Information",
    "Documents and Settings",
    "Recovery",
    "PerfLogs",
    "MSOCache",
    "AppData",
    "Application Data",
    "Local Settings",
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "node_modules",
}


def get_allowed_roots() -> list[Path]:
    """Returns allowed base directories for local folder browsing and conversion."""
    roots = [BASE_DIR.resolve(), Path.home().resolve(), Path("/tmp").resolve()]
    for extra in ("/media", "/mnt", "/run/media"):
        ep = Path(extra)
        if ep.exists():
            roots.append(ep.resolve())
    return roots


def normalize_windows_or_wsl_path(raw_path: str) -> str:
    """Translates Windows paths like 'C:\\Users\\...' or 'D:/Music' to WSL '/mnt/c/...'."""
    cleaned = raw_path.strip().strip('"').strip("'")
    win_match = re.match(r"^([a-zA-Z]):(?:[\\/](.*))?$", cleaned)
    if win_match:
        drive = win_match.group(1).lower()
        rest = (win_match.group(2) or "").replace("\\", "/").strip("/")
        return f"/mnt/{drive}/{rest}" if rest else f"/mnt/{drive}"
    return cleaned


def resolve_safe_dir(raw_path: str | None, default_dir: Path, must_exist: bool = True) -> Path:
    """Validates and resolves a directory path within allowed local roots (WSL + Windows /mnt/*)."""
    if not raw_path or not isinstance(raw_path, str) or not raw_path.strip():
        return default_dir.resolve()
    cleaned = normalize_windows_or_wsl_path(raw_path)
    p = Path(cleaned).expanduser()
    if not p.is_absolute():
        p = BASE_DIR / p
    resolved = p.resolve()

    allowed_roots = get_allowed_roots()
    matched_root = next((r for r in allowed_roots if resolved.is_relative_to(r)), None)
    if matched_root is None:
        raise ValueError(f"Akses folder ditolak (di luar Home / Windows /mnt / Media / Project): {resolved}")

    rel_parts = resolved.relative_to(matched_root).parts
    if any(part.startswith(".") for part in rel_parts):
        raise ValueError("Tidak diizinkan mengakses folder sistem tersembunyi (dot-folder).")

    if must_exist and not resolved.is_dir():
        raise ValueError(f"Folder tidak ditemukan: {resolved}")
    return resolved


def iter_audio_files_safe(root_dir: Path, allowed_exts: set[str] | None = None) -> list[Path]:
    """Safely walks root_dir (including Windows /mnt/* drives), skipping inaccessible NTFS junctions."""
    exts = allowed_exts if allowed_exts is not None else audio_manager.EXTENSIONS
    results: list[Path] = []
    if not root_dir.is_dir():
        return results
    for dirpath, dirnames, filenames in os.walk(root_dir, onerror=lambda _: None):
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".") and not d.startswith("$") and d not in SKIP_SYSTEM_DIRS
        )
        for fname in sorted(filenames):
            if fname.startswith("."):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in exts:
                results.append(Path(dirpath) / fname)
    return results


def get_windows_shortcuts() -> list[dict]:
    """Builds quick-access shortcuts for WSL + Windows drives and user folders."""
    shortcuts = [
        {"label": "📥 Inbox Proyek", "path": str(INBOX_DIR.resolve())},
        {"label": "🏠 WSL Home", "path": str(Path.home().resolve())},
    ]
    wsl_music = Path.home() / "Music"
    if wsl_music.is_dir():
        shortcuts.append({"label": "🎵 WSL Music", "path": str(wsl_music.resolve())})

    mnt_root = Path("/mnt")
    if mnt_root.is_dir():
        # Detect Windows user profile directories under /mnt/c/Users
        win_users_dir = mnt_root / "c" / "Users"
        if win_users_dir.is_dir():
            skip_users = {"Public", "Default", "Default User", "All Users"}
            try:
                for udir in sorted(win_users_dir.iterdir()):
                    if udir.name.startswith(".") or udir.name in skip_users:
                        continue
                    try:
                        if not udir.is_dir():
                            continue
                    except OSError:
                        continue
                    shortcuts.append({"label": f"🪟 Win User ({udir.name})", "path": str(udir)})
                    for sub_label, sub_name in (("🎵 Win Music", "Music"), ("⬇️ Win Downloads", "Downloads"), ("🖥️ Win Desktop", "Desktop")):
                        sub_p = udir / sub_name
                        try:
                            if sub_p.is_dir():
                                shortcuts.append({"label": sub_label, "path": str(sub_p)})
                        except OSError:
                            pass
            except OSError:
                pass

        # Detect mounted Windows drive letters (/mnt/c, /mnt/d, /mnt/e, ...)
        try:
            for d in sorted(mnt_root.iterdir()):
                if len(d.name) == 1 and d.name.isalpha():
                    try:
                        if d.is_dir():
                            shortcuts.append({
                                "label": f"💽 Drive {d.name.upper()}: (/mnt/{d.name.lower()})",
                                "path": str(d),
                            })
                    except OSError:
                        pass
        except OSError:
            pass

    for m_root in ("/media", "/run/media"):
        mp = Path(m_root)
        if mp.is_dir():
            shortcuts.append({"label": f"💾 {m_root}", "path": str(mp.resolve())})
    return shortcuts


def probe_files_fast(files: list[Path]) -> None:
    """Fast parallel ffprobe metadata check for sample rate, codec, and bitrate."""
    if not shutil.which("ffprobe"):
        return
    to_probe: list[tuple[Path, int]] = []
    for p in files:
        try:
            mtime = int(p.stat().st_mtime)
        except OSError:
            continue
        existing = cached_meta_results.get(str(p))
        if not existing or existing.get("_mtime") != mtime:
            to_probe.append((p, mtime))

    if not to_probe:
        return

    def _one(item: tuple[Path, int]):
        path_obj, mtime_val = item
        try:
            meta = audio_manager.metadata(path_obj)
            meta["_mtime"] = mtime_val
            cached_meta_results[str(path_obj)] = meta
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(_one, to_probe))


def check_system_binaries() -> dict:
    """Verifies available system binaries required for audio operations."""
    return {
        "python": sys.version.split()[0],
        "yt_dlp": shutil.which("yt-dlp") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "cookies_present": COOKIES_FILE.is_file(),
    }


def validate_url(url_str: str) -> bool:
    """Strictly validates input URL for allowed scheme and domain."""
    if not url_str or not isinstance(url_str, str):
        return False
    try:
        parsed = urlparse(url_str.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        netloc = parsed.netloc.lower()
        allowed_domains = [
            "youtube.com", "www.youtube.com", "m.youtube.com",
            "music.youtube.com", "youtu.be"
        ]
        return any(netloc == domain or netloc.endswith("." + domain) for domain in allowed_domains)
    except Exception:
        return False


def run_worker():
    """Background worker processing tasks from task_queue sequentially."""
    global current_task
    while True:
        task = None
        with queue_lock:
            if task_queue:
                task = task_queue.pop(0)
                current_task = task
            else:
                current_task = None

        if not task:
            time.sleep(1)
            continue

        task["status"] = "PROCESSING"
        task["logs"] = []
        task["progress"] = 0

        if task.get("type") == "resample":
            target_rate = int(task.get("target_rate", 44100))
            target_bitrate = int(task.get("target_bitrate", 320))
            rel_path = task.get("rel_path")
            rel_paths = task.get("rel_paths")
            playlist = task.get("playlist")
            only_mp3 = bool(task.get("only_mp3", False))
            overwrite = bool(task.get("overwrite", False))
            raw_source_dir = task.get("source_dir")
            raw_dest_dir = task.get("dest_dir")

            if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
                task["status"] = "FAILED"
                task["error"] = "FFmpeg / FFprobe belum terinstall di PATH."
                with queue_lock:
                    task_history.insert(0, task)
                    current_task = None
                continue

            try:
                source_resolved = resolve_safe_dir(raw_source_dir, INBOX_DIR, must_exist=True)
                dest_resolved = (
                    resolve_safe_dir(raw_dest_dir, INBOX_DIR, must_exist=False)
                    if (raw_dest_dir and str(raw_dest_dir).strip())
                    else None
                )
            except Exception as dir_exc:
                task["status"] = "FAILED"
                task["error"] = str(dir_exc)
                task["logs"].append(f"[RESAMPLE ERROR] {dir_exc}")
                with queue_lock:
                    task_history.insert(0, task)
                    current_task = None
                continue

            allowed = {".mp3"} if only_mp3 else audio_manager.EXTENSIONS

            if isinstance(rel_paths, list) and rel_paths:
                files = []
                for rp in rel_paths:
                    if isinstance(rp, str) and rp.strip():
                        cand = (source_resolved / rp.strip()).resolve()
                        if cand.is_relative_to(source_resolved) and cand.is_file() and cand.suffix.lower() in allowed:
                            files.append(cand)
            elif rel_path:
                target_file = (source_resolved / rel_path).resolve()
                files = [target_file] if (target_file.is_relative_to(source_resolved) and target_file.is_file()) else []
            elif playlist:
                if playlist == "__ROOT__":
                    files = sorted(
                        p for p in source_resolved.iterdir()
                        if p.is_file() and p.suffix.lower() in allowed and not p.name.startswith(".")
                    )
                else:
                    pl_dir = (source_resolved / playlist).resolve()
                    if pl_dir.is_relative_to(source_resolved) and pl_dir.is_dir():
                        files = iter_audio_files_safe(pl_dir, allowed)
                    else:
                        files = []
            else:
                files = [
                    p for p in iter_audio_files_safe(source_resolved, allowed)
                    if not re.search(r"\[(44\.1kHz|48kHz)(?:\s+\d+k)?\]$", p.parent.name)
                ]

            total = len(files)
            if total == 0:
                task["logs"].append("[RESAMPLE] Tidak ada file audio yang cocok untuk dikonversi.")
                task["status"] = "SUCCESS"
                task["progress"] = 100
                with queue_lock:
                    task_history.insert(0, task)
                    current_task = None
                continue

            mode_desc = "OVERWRITE" if overwrite else (f"TUJUAN: {dest_resolved}" if dest_resolved else "SALIN BARU OTOMATIS")
            task["logs"].append(
                f"[RESAMPLE] Memulai konversi ke {target_rate} Hz • {target_bitrate} kbps [{mode_desc}] ({total} file)..."
            )
            converted_count = 0
            skipped_count = 0
            error_count = 0

            for idx, fpath in enumerate(files, 1):
                task["progress"] = min(99, round(((idx - 1) / total) * 100))
                try:
                    file_out_dir = None
                    if dest_resolved is not None:
                        rel_parent = fpath.parent.relative_to(source_resolved)
                        file_out_dir = dest_resolved / rel_parent if rel_parent != Path(".") else dest_resolved

                    res = audio_manager.resample_one(
                        fpath,
                        target_rate=target_rate,
                        target_bitrate=target_bitrate,
                        overwrite=overwrite,
                        out_dir=file_out_dir,
                    )
                    if res["status"] == "CONVERTED":
                        converted_count += 1
                        task["logs"].append(f"[{idx}/{total}] CONVERTED: {res['message']}")
                        out_p = Path(res["file"])
                        old_p_str = res.get("old_file", str(fpath))
                        if overwrite and old_p_str != str(out_p):
                            cached_qc_results.pop(old_p_str, None)
                            cached_meta_results.pop(old_p_str, None)
                        try:
                            meta = audio_manager.metadata(out_p)
                            meta["_mtime"] = int(out_p.stat().st_mtime)
                            cached_meta_results[str(out_p)] = meta
                            if str(out_p) in cached_qc_results:
                                cached_qc_results[str(out_p)].update(meta)
                        except Exception:
                            pass
                    else:
                        skipped_count += 1
                        task["logs"].append(f"[{idx}/{total}] SKIPPED: {fpath.name} ({res['message']})")
                except Exception as exc:
                    error_count += 1
                    task["logs"].append(f"[{idx}/{total}] ERROR {fpath.name}: {exc}")
                if len(task["logs"]) > 200:
                    task["logs"].pop(0)

            task["logs"].append(
                f"[RESAMPLE SELESAI] Dikonversi: {converted_count} | Dilewati: {skipped_count} | Error: {error_count}"
            )
            task["progress"] = 100
            task["status"] = "SUCCESS" if error_count == 0 else "FAILED"
            with queue_lock:
                task_history.insert(0, task)
                current_task = None
            continue

        url = task["url"]
        auto_scan = task.get("auto_scan", True)

        INBOX_DIR.mkdir(parents=True, exist_ok=True)
        ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)

        if not shutil.which("yt-dlp"):
            task["status"] = "FAILED"
            task["error"] = "yt-dlp belum terinstall di sistem. Jalankan: pip install yt-dlp"
            task["progress"] = 0
            with queue_lock:
                task_history.insert(0, task)
                current_task = None
            continue

        audio_format = task.get("audio_format", "native")
        if audio_format == "premium_aac":  # legacy alias
            audio_format = "native"
        keep_opus = bool(task.get("keep_opus", False))
        is_playlist = bool(task.get("is_playlist", False))
        use_cookies = bool(task.get("use_cookies", True))
        cookie_browser = str(task.get("cookie_browser", "chrome")).lower()

        if is_playlist:
            template = str(INBOX_DIR / "%(playlist_title,playlist|Playlist)s" / "%(title).150B [%(id)s].%(ext)s")
        else:
            template = str(INBOX_DIR / "%(title).150B [%(id)s].%(ext)s")

        removed_stale = audio_manager.sync_download_archive(INBOX_DIR, ARCHIVE_FILE, audio_format, keep_opus)
        if removed_stale > 0:
            task["logs"].append(
                f"[ARCHIVE SYNC] Membersihkan {removed_stale} ID riwayat lama di downloaded_ids.txt yang file targetnya belum ada di inbox."
            )

        js_runtime, run_env = audio_manager.find_js_runtime()

        def build_cmd(with_cookies: bool):
            cmd = ["yt-dlp"]
            if audio_format == "native":
                # Audio-only stream, kept as-is. Prioritize Premium 256k (141 AAC / 774 Opus),
                # then Public 160k 48kHz Opus (251), 128k AAC (140), and non-DRC streams.
                cmd.extend(["-f", audio_manager.YOUTUBE_AUDIO_SELECTOR])
            elif keep_opus:
                cmd.extend(["-f", f"{audio_manager.YOUTUBE_OPUS_SELECTOR}/b"])
            else:
                cmd.extend(["-f", f"{audio_manager.YOUTUBE_AUDIO_SELECTOR}/b"])

            if js_runtime:
                cmd.extend(["--js-runtimes", js_runtime])
            cmd.extend(["--remote-components", "ejs:github"])

            cmd.extend([
                "--download-archive", str(ARCHIVE_FILE),
                "-o", template,
                "--yes-playlist" if is_playlist else "--no-playlist",
            ])

            auth_desc = "Public"
            if with_cookies:
                if COOKIES_FILE.is_file():
                    cmd.extend(["--cookies", str(COOKIES_FILE)])
                    auth_desc = "cookies.txt"
                elif cookie_browser:
                    cmd.extend(["--cookies-from-browser", cookie_browser])
                    auth_desc = cookie_browser

            opus_note = " + Simpan File Asli Opus (.webm)" if keep_opus else ""
            if audio_format == "mp3_320k":
                cmd.extend([
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", "320K",
                    "--embed-metadata",
                ])
                if keep_opus:
                    cmd.append("--keep-video")
                desc = f"Target: MP3 320 kbps CBR{opus_note} (KONVERSI lossy, Auth: {auth_desc})"
            elif audio_format == "mp3_vbr0":
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
                desc = f"Target: Best Available - stream asli YouTube tanpa konversi (Auth: {auth_desc})"

            cmd.append(url)
            return cmd, desc

        downloaded_files_before = set(p for p in INBOX_DIR.rglob("*") if p.is_file())
        attempts = [True] if use_cookies else [False]
        if use_cookies:
            attempts.append(False)  # Fallback: retry without cookies if browser cookie DB is locked

        success = False
        final_code = 0

        for try_idx, with_cookies in enumerate(attempts):
            cmd, target_desc = build_cmd(with_cookies)
            if try_idx > 0:
                task["logs"].append(f"[AUTH FALLBACK] Sesi {cookie_browser} bermasalah/terkunci. Beralih otomatis ke Fallback Mode Publik...")
            task["logs"].append(target_desc)
            task["logs"].append(f"Starting extraction for: {url}")

            cookie_err_detected = False
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                    env=run_env,
                )

                if proc.stdout:
                    for line in proc.stdout:
                        clean_line = line.strip()
                        if clean_line:
                            task["logs"].append(clean_line)
                            if len(task["logs"]) > 200:
                                task["logs"].pop(0)

                            if with_cookies and any(k in clean_line.lower() for k in ("could not copy", "cookie database", "database is locked", "failed to extract cookies")):
                                cookie_err_detected = True

                            fmt_match = re.search(r"Downloading \d+ format\(s\):\s*([^\s,]+)", clean_line)
                            if fmt_match:
                                task["logs"].append(audio_manager.describe_format_tier(fmt_match.group(1)))

                            # Parse percentage progress from yt-dlp output
                            match = re.search(r"\[download\]\s+([\d\.]+)%", clean_line)
                            if match:
                                try:
                                    task["progress"] = min(99, float(match.group(1)))
                                except ValueError:
                                    pass

                proc.wait()
                if proc.returncode == 0:
                    success = True
                    break
                else:
                    final_code = proc.returncode
                    if with_cookies and (cookie_err_detected or len(attempts) > try_idx + 1):
                        continue
                    else:
                        break
            except Exception as proc_exc:
                task["logs"].append(f"Execution error: {proc_exc}")
                final_code = 1
                if with_cookies and len(attempts) > try_idx + 1:
                    continue
                break

        if success:
            task["status"] = "SUCCESS"
            task["progress"] = 100
            task["logs"].append("Extraction finished successfully.")

            # If auto_scan enabled, scan newly downloaded files (including inside playlist folders)
            if auto_scan and shutil.which("ffmpeg") and shutil.which("ffprobe"):
                task["logs"].append("Initiating audio QC audit (EBU R128 & True Peak)...")
                downloaded_files_after = set(p for p in INBOX_DIR.rglob("*") if p.is_file())
                new_files = [f for f in downloaded_files_after if f not in downloaded_files_before and f.suffix.lower() in audio_manager.EXTENSIONS]
                for nf in new_files:
                    try:
                        qc_data = audio_manager.audit_one(nf)
                        cached_qc_results[str(nf)] = qc_data
                        task["logs"].append(f"QC completed: {nf.name} [Status: {qc_data.get('status')}]")
                    except Exception as qc_err:
                        task["logs"].append(f"QC error on {nf.name}: {qc_err}")
        else:
            task["status"] = "FAILED"
            task["error"] = f"yt-dlp exited with code {final_code}"

        with queue_lock:
            task_history.insert(0, task)
            current_task = None


class AudioServerHandler(BaseHTTPRequestHandler):
    """Secure HTTP Request Handler binding to 127.0.0.1."""

    def log_message(self, format, *args):
        # Clean server log format
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def send_security_headers(self, content_type: str = "application/json"):
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self';"
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            self.serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif path in ("/converter", "/converter.html"):
            self.serve_file(STATIC_DIR / "converter.html", "text/html; charset=utf-8")
        elif path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            safe_file = (STATIC_DIR / rel_path).resolve()
            # Enforce sandbox directory boundary strictly
            if safe_file.is_relative_to(STATIC_DIR) and safe_file.is_file():
                mime, _ = mimetypes.guess_type(str(safe_file))
                self.serve_file(safe_file, mime or "application/octet-stream")
            else:
                self.send_error(404, "File not found")
        elif path == "/api/system":
            data = check_system_binaries()
            self.send_json(200, data)
        elif path == "/api/queue":
            with queue_lock:
                data = {
                    "current": current_task,
                    "queue": list(task_queue),
                    "history": list(task_history[:10])
                }
            self.send_json(200, data)
        elif path == "/api/library":
            qs = parse_qs(parsed.query)
            raw_src = qs.get("source_dir", [None])[0]
            try:
                src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
                files_data, playlists_data = self.get_library_files(src_dir)
                self.send_json(200, {
                    "files": files_data,
                    "playlists": playlists_data,
                    "source_dir": str(src_dir),
                    "default_inbox": str(INBOX_DIR.resolve()),
                })
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
        else:
            self.send_error(404, "Endpoint not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 1024 * 1024:  # 1MB limit for JSON payload
            self.send_error(413, "Payload too large")
            return

        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        if path == "/api/download":
            urls = payload.get("urls", [])
            auto_scan = bool(payload.get("auto_scan", True))
            is_playlist = bool(payload.get("is_playlist", False))
            use_cookies = bool(payload.get("use_cookies", True))
            cookie_browser = str(payload.get("cookie_browser", "chrome")).strip().lower()
            if cookie_browser not in ("chrome", "chromium", "firefox", "brave", "edge", "opera", "vivaldi"):
                cookie_browser = "chrome"

            audio_format = str(payload.get("audio_format", "native")).lower()
            if audio_format == "premium_aac":  # legacy alias
                audio_format = "native"
            if audio_format not in ("native", "mp3_320k", "mp3_vbr0"):
                audio_format = "native"
            keep_opus = bool(payload.get("keep_opus", False))

            if isinstance(urls, str):
                urls = [line.strip() for line in urls.splitlines() if line.strip()]

            valid_tasks = []
            for u in urls:
                if validate_url(u):
                    valid_tasks.append({
                        "id": f"job_{int(time.time() * 1000)}_{len(valid_tasks)}",
                        "url": u.strip(),
                        "status": "QUEUED",
                        "auto_scan": auto_scan,
                        "is_playlist": is_playlist,
                        "audio_format": audio_format,
                        "keep_opus": keep_opus,
                        "use_cookies": use_cookies,
                        "cookie_browser": cookie_browser,
                        "progress": 0,
                        "created_at": time.time()
                    })

            if not valid_tasks:
                self.send_json(400, {
                    "error": "Tidak ada URL YouTube yang valid. Pastikan domain youtube.com / youtu.be."
                })
                return

            with queue_lock:
                task_queue.extend(valid_tasks)

            self.send_json(200, {
                "message": f"Berhasil menambahkan {len(valid_tasks)} item ke antrian.",
                "added_count": len(valid_tasks)
            })

        elif path == "/api/scan":
            # Force QC scan on all library files recursively
            try:
                results = self.scan_library()
                self.send_json(200, {"message": "Audit selesai", "results": results})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
        elif path == "/api/browse-dirs":
            raw_path = payload.get("path")
            create_sub = payload.get("create_subfolder")
            try:
                curr_dir = resolve_safe_dir(raw_path, INBOX_DIR, must_exist=True)
                if isinstance(create_sub, str) and create_sub.strip():
                    clean_sub = re.sub(r'[<>:"/\\|?*]', "", create_sub.strip())
                    if clean_sub and not clean_sub.startswith("."):
                        new_dir = (curr_dir / clean_sub).resolve()
                        if new_dir.is_relative_to(curr_dir):
                            new_dir.mkdir(parents=True, exist_ok=True)
                            curr_dir = new_dir

                allowed_roots = get_allowed_roots()
                parent_path = None
                if curr_dir.parent != curr_dir:
                    if any(curr_dir.parent.is_relative_to(r) for r in allowed_roots):
                        parent_path = str(curr_dir.parent)

                subdirs = []
                try:
                    entries = sorted(curr_dir.iterdir(), key=lambda x: x.name.lower())
                except OSError:
                    entries = []
                for d in entries:
                    if d.name.startswith(".") or d.name.startswith("$") or d.name in SKIP_SYSTEM_DIRS:
                        continue
                    try:
                        if not d.is_dir():
                            continue
                        audio_cnt = sum(
                            1 for f in d.iterdir()
                            if not f.name.startswith(".") and f.suffix.lower() in audio_manager.EXTENSIONS and f.is_file()
                        )
                    except OSError:
                        audio_cnt = 0
                        continue
                    subdirs.append({"name": d.name, "path": str(d), "audio_count": audio_cnt})

                shortcuts = get_windows_shortcuts()

                self.send_json(200, {
                    "current": str(curr_dir),
                    "parent": parent_path,
                    "dirs": subdirs,
                    "subdirs": subdirs,
                    "shortcuts": shortcuts,
                })
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})

        elif path == "/api/probe":
            folder = payload.get("folder")
            raw_src = payload.get("source_dir")
            try:
                source_resolved = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
                return

            if not source_resolved.exists():
                self.send_json(200, {"files": [], "playlists": [], "source_dir": str(source_resolved)})
                return

            if folder == "__ROOT__":
                target_files = [
                    p for p in source_resolved.iterdir()
                    if p.is_file() and p.suffix.lower() in audio_manager.EXTENSIONS and not p.name.startswith(".")
                ]
            elif isinstance(folder, str) and folder.strip():
                pl_dir = (source_resolved / folder.strip()).resolve()
                if not pl_dir.is_relative_to(source_resolved) or not pl_dir.is_dir():
                    self.send_json(400, {"error": "Folder playlist tidak ditemukan."})
                    return
                target_files = iter_audio_files_safe(pl_dir)
            else:
                target_files = iter_audio_files_safe(source_resolved)

            probe_files_fast(target_files)
            files_data, playlists_data = self.get_library_files(source_resolved)
            self.send_json(200, {
                "files": files_data,
                "playlists": playlists_data,
                "source_dir": str(source_resolved),
            })

        elif path == "/api/resample":
            target_rate = int(payload.get("target_rate", 44100))
            if target_rate not in (44100, 48000):
                self.send_json(400, {"error": "Target sample rate hanya mendukung 44100 atau 48000 Hz."})
                return

            target_bitrate = int(payload.get("target_bitrate", 320))
            if target_bitrate not in audio_manager.ALLOWED_BITRATES:
                self.send_json(400, {"error": "Target bitrate hanya mendukung 320, 192, 128, atau 96 kbps."})
                return

            raw_source_dir = payload.get("source_dir")
            raw_dest_dir = payload.get("dest_dir")
            try:
                source_resolved = resolve_safe_dir(raw_source_dir, INBOX_DIR, must_exist=True) if raw_source_dir else INBOX_DIR.resolve()
                dest_resolved = (
                    resolve_safe_dir(raw_dest_dir, INBOX_DIR, must_exist=False)
                    if (isinstance(raw_dest_dir, str) and raw_dest_dir.strip())
                    else None
                )
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
                return

            rel_path = payload.get("rel_path")
            rel_paths = payload.get("rel_paths")
            playlist = payload.get("playlist")
            only_mp3 = bool(payload.get("only_mp3", False))
            overwrite = bool(payload.get("overwrite", False))
            spec_str = f"{target_rate} Hz • {target_bitrate} kbps"

            if isinstance(rel_paths, list) and rel_paths:
                valid_rels = []
                for rp in rel_paths:
                    if isinstance(rp, str) and rp.strip():
                        cand = (source_resolved / rp.strip()).resolve()
                        if cand.is_relative_to(source_resolved) and cand.is_file():
                            valid_rels.append(rp.strip())
                if not valid_rels:
                    self.send_json(400, {"error": "Tidak ada file valid yang dipilih."})
                    return
                label = f"Konversi {len(valid_rels)} Lagu Terpilih -> {spec_str}"
                rel_paths = valid_rels
            elif rel_path is not None:
                if not isinstance(rel_path, str) or not rel_path.strip():
                    self.send_json(400, {"error": "Path file tidak valid."})
                    return
                rel_path = rel_path.strip()
                candidate = (source_resolved / rel_path).resolve()
                if not candidate.is_relative_to(source_resolved) or not candidate.is_file():
                    self.send_json(404, {"error": "File audio tidak ditemukan di folder sumber."})
                    return
                label = f"Konversi {candidate.name} -> {spec_str}"
            elif isinstance(playlist, str) and playlist.strip():
                playlist = playlist.strip()
                if playlist != "__ROOT__":
                    pl_dir = (source_resolved / playlist).resolve()
                    if not pl_dir.is_relative_to(source_resolved) or not pl_dir.is_dir():
                        self.send_json(404, {"error": "Folder playlist tidak ditemukan."})
                        return
                pl_name = "Root Folder" if playlist == "__ROOT__" else playlist
                scope_label = "MP3" if only_mp3 else "Semua Lagu"
                label = f"Konversi Playlist '{pl_name}' ({scope_label}) -> {spec_str}"
            else:
                scope_label = "Semua MP3" if only_mp3 else "Semua File"
                label = f"Konversi Folder '{source_resolved.name}' ({scope_label}) -> {spec_str}"

            job = {
                "id": f"resample_{int(time.time() * 1000)}",
                "type": "resample",
                "url": label,
                "source_dir": str(source_resolved),
                "dest_dir": str(dest_resolved) if dest_resolved else None,
                "rel_path": rel_path,
                "rel_paths": rel_paths if isinstance(rel_paths, list) else None,
                "playlist": playlist,
                "target_rate": target_rate,
                "target_bitrate": target_bitrate,
                "only_mp3": only_mp3,
                "overwrite": overwrite,
                "status": "QUEUED",
                "progress": 0,
                "created_at": time.time(),
            }
            with queue_lock:
                task_queue.append(job)

            self.send_json(200, {
                "message": f"Tugas konversi ({label}) ditambahkan ke antrian.",
                "job_id": job["id"],
            })
        else:
            self.send_error(404, "Endpoint not found")

    def serve_file(self, file_path: Path, content_type: str):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_security_headers(content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as exc:
            self.send_error(500, f"Error reading file: {exc}")

    def send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_security_headers("application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_library_files(self, base_dir: Path | None = None) -> tuple[list[dict], list[dict]]:
        """Returns (files, playlists) in base_dir (defaults to INBOX_DIR) with metadata and cached QC."""
        target_dir = (base_dir or INBOX_DIR).resolve()
        if not target_dir.exists() or not target_dir.is_dir():
            return [], []

        playlist_counts: dict[str, dict] = {}
        try:
            top_entries = sorted(target_dir.iterdir(), key=lambda x: x.name.lower())
        except OSError:
            top_entries = []
        for d in top_entries:
            if d.name.startswith(".") or d.name.startswith("$") or d.name in SKIP_SYSTEM_DIRS:
                continue
            try:
                if d.is_dir():
                    playlist_counts[d.name] = {"name": d.name, "total": 0, "mp3_count": 0, "other_count": 0}
            except OSError:
                continue

        items = []
        root_total = 0
        root_mp3 = 0
        for p in iter_audio_files_safe(target_dir):
            try:
                stat = p.stat()
            except OSError:
                continue
            qc = cached_qc_results.get(str(p))
            meta = cached_meta_results.get(str(p))
            merged_qc = None
            if qc or meta:
                merged_qc = dict(meta or {})
                if qc:
                    merged_qc.update(qc)

            rel = p.relative_to(target_dir)
            folder_name = str(rel.parent) if rel.parent != Path(".") else ""
            ext = p.suffix.lower()

            if folder_name:
                top_folder = rel.parts[0]
                if top_folder not in playlist_counts:
                    playlist_counts[top_folder] = {"name": top_folder, "total": 0, "mp3_count": 0, "other_count": 0}
                playlist_counts[top_folder]["total"] += 1
                if ext == ".mp3":
                    playlist_counts[top_folder]["mp3_count"] += 1
                else:
                    playlist_counts[top_folder]["other_count"] += 1
            else:
                root_total += 1
                if ext == ".mp3":
                    root_mp3 += 1

            items.append({
                "name": p.name,
                "ext": ext,
                "folder": folder_name,
                "rel_path": str(rel),
                "path": str(p),
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified": int(stat.st_mtime),
                "qc": merged_qc
            })

        playlists = list(playlist_counts.values())
        if root_total > 0:
            playlists.insert(0, {
                "name": "__ROOT__",
                "label": f"File di Root ({target_dir.name})",
                "total": root_total,
                "mp3_count": root_mp3,
                "other_count": root_total - root_mp3,
            })
        return items, playlists

    def scan_library(self) -> list[dict]:
        """Runs audit on all files in inbox directory recursively."""
        if not INBOX_DIR.exists():
            return []
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("FFmpeg / FFprobe tidak ditemukan di PATH. Silakan install FFmpeg terlebih dahulu.")

        files = sorted(p for p in INBOX_DIR.rglob("*") if p.is_file() and p.suffix.lower() in audio_manager.EXTENSIONS)
        audited = []
        for f in files:
            row = audio_manager.audit_one(f)
            cached_qc_results[str(f)] = row
            audited.append(row)
        return audited


def main():
    host = "127.0.0.1"  # Bound strictly to localhost for security
    port = 8765

    # Start queue worker thread
    worker_thread = threading.Thread(target=run_worker, daemon=True)
    worker_thread.start()

    server = HTTPServer((host, port), AudioServerHandler)
    print("=" * 65)
    print("  AUDIO LAB // BATCH INGESTION & SOUNDSYSTEM QC ENGINE")
    print("=" * 65)
    print(f"  Server running locally at: http://{host}:{port}")
    print(f"  Inbox Folder: {INBOX_DIR}")
    print("  Press Ctrl+C to stop.")
    print("=" * 65)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
        server.server_close()


if __name__ == "__main__":
    main()
