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
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

# Import existing audit and helper functions from audio_manager
import audio_manager

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INBOX_DIR = BASE_DIR / "library" / "inbox"
ARCHIVE_FILE = BASE_DIR / "library" / "downloaded_ids.txt"

# In-memory queue state
queue_lock = threading.Lock()
task_queue: list[dict] = []
current_task: dict | None = None
task_history: list[dict] = []
cached_qc_results: dict[str, dict] = {}


def check_system_binaries() -> dict:
    """Verifies available system binaries required for audio operations."""
    return {
        "python": sys.version.split()[0],
        "yt_dlp": shutil.which("yt-dlp") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
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

        audio_format = task.get("audio_format", "premium_aac")
        is_playlist = bool(task.get("is_playlist", False))
        use_cookies = bool(task.get("use_cookies", True))
        cookie_browser = str(task.get("cookie_browser", "chrome")).lower()

        if is_playlist:
            template = str(INBOX_DIR / "%(playlist_title,playlist|Playlist)s" / "%(title).150B [%(id)s].%(ext)s")
        else:
            template = str(INBOX_DIR / "%(title).150B [%(id)s].%(ext)s")

        def build_cmd(with_cookies: bool):
            cmd = ["yt-dlp"]
            if audio_format == "premium_aac":
                cmd.extend(["-f", "ba[format_id=141]/ba[ext=m4a]/ba/b"])
            else:
                cmd.extend(["-f", "ba/b"])

            if shutil.which("node"):
                cmd.extend(["--js-runtimes", "node"])

            cmd.extend([
                "--download-archive", str(ARCHIVE_FILE),
                "-o", template,
                "--yes-playlist" if is_playlist else "--no-playlist",
            ])

            if with_cookies and cookie_browser:
                cmd.extend(["--cookies-from-browser", cookie_browser])

            if audio_format == "premium_aac":
                cmd.extend([
                    "--extract-audio",
                    "--audio-format", "m4a",
                    "--audio-quality", "0",
                    "--embed-metadata",
                ])
                desc = f"Target: Premium AAC 256k (YouTube Music{' via ' + cookie_browser if with_cookies else ' - Public Fallback'})"
            elif audio_format == "mp3_320k":
                cmd.extend([
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", "320K",
                    "--embed-metadata",
                ])
                desc = "Target: MP3 320 kbps CBR (LAME - Kualitas Tertinggi)"
            elif audio_format == "mp3_vbr0":
                cmd.extend([
                    "--extract-audio",
                    "--audio-format", "mp3",
                    "--audio-quality", "0",
                    "--embed-metadata",
                ])
                desc = "Target: MP3 VBR 0 (LAME Extreme Dynamic Bitrate)"
            else:
                cmd.extend([
                    "--extract-audio",
                    "--audio-format", "best",
                    "--audio-quality", "0",
                    "--embed-metadata",
                ])
                desc = "Target: Native Stream (Opus 48kHz / AAC - Preservasi Bit Asli)"

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
                    universal_newlines=True
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
            files_data = self.get_library_files()
            self.send_json(200, {"files": files_data})
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

            audio_format = str(payload.get("audio_format", "premium_aac")).lower()
            if audio_format not in ("premium_aac", "native", "mp3_320k", "mp3_vbr0"):
                audio_format = "premium_aac"

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

    def get_library_files(self) -> list[dict]:
        """Returns list of audio files in inbox (recursive) with metadata and cached QC."""
        if not INBOX_DIR.exists():
            return []
        items = []
        for p in sorted(INBOX_DIR.rglob("*")):
            if p.is_file() and p.suffix.lower() in audio_manager.EXTENSIONS:
                qc = cached_qc_results.get(str(p))
                stat = p.stat()
                rel = p.relative_to(INBOX_DIR)
                folder_name = str(rel.parent) if rel.parent != Path(".") else ""
                items.append({
                    "name": p.name,
                    "folder": folder_name,
                    "rel_path": str(rel),
                    "path": str(p),
                    "size_mb": round(stat.st_size / (1024 * 1024), 2),
                    "modified": int(stat.st_mtime),
                    "qc": qc
                })
        return items

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
