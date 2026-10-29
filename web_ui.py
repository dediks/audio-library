#!/usr/bin/env python3
"""Audio Library Web UI: Localhost Server for Batch Ingestion & QC Monitoring.

Designed for audio engineers and programmers.
Listens strictly on 127.0.0.1 for maximum local security.
"""
from __future__ import annotations

import json
import mimetypes
import shutil
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import audio_manager
import fs_browser
from task_engine import AudioMetadataCache, TaskQueueManager

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
INBOX_DIR = BASE_DIR / "library" / "inbox"
ARCHIVE_FILE = BASE_DIR / "library" / "downloaded_ids.txt"
COOKIES_FILE = BASE_DIR / "library" / "cookies.txt"

# Instantiate shared state managers
metadata_cache = AudioMetadataCache()
task_manager = TaskQueueManager(
    metadata_cache=metadata_cache,
    inbox_dir=INBOX_DIR,
    archive_file=ARCHIVE_FILE,
    cookies_file=COOKIES_FILE,
)

# Backward-compatible module-level aliases
SKIP_SYSTEM_DIRS = fs_browser.SKIP_SYSTEM_DIRS
get_allowed_roots = fs_browser.get_allowed_roots
normalize_windows_or_wsl_path = fs_browser.normalize_windows_or_wsl_path
resolve_safe_dir = fs_browser.resolve_safe_dir
iter_audio_files_safe = fs_browser.iter_audio_files_safe
get_windows_shortcuts = fs_browser.get_windows_shortcuts
validate_url = fs_browser.validate_url

queue_lock = task_manager.lock
cache_lock = metadata_cache.lock
task_queue = task_manager.queue
task_history = task_manager.history
cached_qc_results = metadata_cache.qc_results
cached_meta_results = metadata_cache.meta_results
probe_files_fast = metadata_cache.probe_files_fast
run_worker = task_manager.run_worker_loop


def check_system_binaries() -> dict:
    """Verifies available system binaries required for audio operations."""
    return {
        "python": sys.version.split()[0],
        "yt_dlp": shutil.which("yt-dlp") is not None,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "cookies_present": COOKIES_FILE.is_file(),
    }


class AudioServerHandler(BaseHTTPRequestHandler):
    """Secure HTTP Request Handler binding to 127.0.0.1."""

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def send_security_headers(self, content_type: str = "application/json"):
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none';",
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
            if safe_file.is_relative_to(STATIC_DIR) and safe_file.is_file():
                ext = safe_file.suffix.lower()
                if ext == ".js":
                    mime = "text/javascript; charset=utf-8"
                elif ext == ".css":
                    mime = "text/css; charset=utf-8"
                else:
                    mime, _ = mimetypes.guess_type(str(safe_file))
                self.serve_file(safe_file, mime or "application/octet-stream")
            else:
                self.send_error(404, "File not found")
        elif path == "/api/system":
            self.send_json(200, check_system_binaries())
        elif path == "/api/queue":
            self.send_json(200, task_manager.get_snapshot(history_limit=10))
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
            status, resp = task_manager.enqueue_downloads(payload)
            self.send_json(status, resp)
        elif path == "/api/scan":
            self._handle_post_scan()
        elif path == "/api/browse-dirs":
            self._handle_post_browse_dirs(payload)
        elif path == "/api/probe":
            self._handle_post_probe(payload)
        elif path == "/api/resample":
            status, resp = task_manager.enqueue_resample(payload)
            self.send_json(status, resp)
        elif path == "/api/open-folder":
            self._handle_post_open_folder(payload)
        elif path == "/api/rename":
            self._handle_post_rename(payload)
        elif path == "/api/delete":
            self._handle_post_delete(payload)
        else:
            self.send_error(404, "Endpoint not found")

    def _handle_post_scan(self) -> None:
        try:
            results = self.scan_library()
            self.send_json(200, {"message": "Audit selesai", "results": results})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def _handle_post_browse_dirs(self, payload: dict) -> None:
        try:
            result = fs_browser.browse_directory(
                raw_path=payload.get("path"),
                create_subfolder=payload.get("create_subfolder"),
                default_inbox=INBOX_DIR,
            )
            self.send_json(200, result)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_probe(self, payload: dict) -> None:
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

        metadata_cache.probe_files_fast(target_files)
        files_data, playlists_data = self.get_library_files(source_resolved)
        self.send_json(200, {
            "files": files_data,
            "playlists": playlists_data,
            "source_dir": str(source_resolved),
        })

    def _handle_post_open_folder(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        raw_folder = payload.get("folder")
        try:
            base = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            if raw_folder and isinstance(raw_folder, str) and raw_folder.strip():
                folder_str = raw_folder.strip()
                if Path(folder_str).is_absolute() or folder_str.startswith("/mnt/"):
                    target = resolve_safe_dir(folder_str, must_exist=True)
                else:
                    target = (base / folder_str).resolve()
                    if not target.is_relative_to(base) or not target.exists():
                        self.send_json(400, {"error": "Folder tidak ditemukan atau berada di luar batas direktori."})
                        return
            else:
                target = base

            ok, msg = fs_browser.open_in_file_manager(target)
            if ok:
                self.send_json(200, {"ok": True, "message": msg, "path": str(target)})
            else:
                self.send_json(500, {"ok": False, "error": msg})
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_rename(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_path = payload.get("rel_path")
        new_name = payload.get("new_name")
        is_folder = payload.get("is_folder")

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, old_p, new_p = fs_browser.rename_fs_entry(
                source_dir=src_dir,
                rel_path=rel_path or "",
                new_name=new_name or "",
                is_folder=is_folder,
            )
            if not ok:
                self.send_json(400, {"error": msg})
                return

            # Update cache keys
            if new_p.is_dir():
                metadata_cache.rename_folder(old_p, new_p)
            else:
                metadata_cache.rename_entry(old_p, new_p)

            self.send_json(200, {
                "ok": True,
                "message": msg,
                "old_name": old_p.name,
                "new_name": new_p.name,
                "rel_path": str(new_p.relative_to(src_dir)),
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_delete(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_path = payload.get("rel_path")
        rel_paths = payload.get("rel_paths")
        is_folder = payload.get("is_folder")

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, deleted_files, deleted_folders = fs_browser.delete_fs_entries(
                source_dir=src_dir,
                rel_paths=rel_paths if isinstance(rel_paths, list) else None,
                rel_path=rel_path if isinstance(rel_path, str) else None,
                is_folder=is_folder if isinstance(is_folder, bool) else None,
            )
            if not ok:
                self.send_json(400, {"error": msg})
                return

            # Evict deleted files and folders from metadata/QC cache
            for fp in deleted_files:
                metadata_cache.remove_entry(fp)
            for dp in deleted_folders:
                metadata_cache.remove_folder(dp)

            # Sync download archive if deletions occurred inside default INBOX_DIR
            inbox_resolved = INBOX_DIR.resolve()
            if src_dir == inbox_resolved or src_dir.is_relative_to(inbox_resolved):
                audio_manager.sync_download_archive(inbox_resolved, ARCHIVE_FILE)

            self.send_json(200, {
                "ok": True,
                "message": msg,
                "deleted_count": len(deleted_files),
                "deleted_paths": [str(p.relative_to(src_dir)) for p in deleted_files if p.is_relative_to(src_dir)],
                "deleted_folders": [str(d.relative_to(src_dir)) for d in deleted_folders if d.is_relative_to(src_dir)],
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

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
        return metadata_cache.get_library_files(base_dir or INBOX_DIR)

    def scan_library(self) -> list[dict]:
        return metadata_cache.scan_library(INBOX_DIR)


def main():
    host = "127.0.0.1"  # Bound strictly to localhost for security
    port = 8765

    worker_thread = threading.Thread(target=run_worker, daemon=True)
    worker_thread.start()

    server = ThreadingHTTPServer((host, port), AudioServerHandler)
    print("=" * 65)
    print("  SWARARIA AUDIO LAB // BATCH INGESTION & SOUNDSYSTEM QC ENGINE")
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
