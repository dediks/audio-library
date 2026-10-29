#!/usr/bin/env python3
"""Thread-Safe Audio Metadata Cache & Background Task Queue Engine."""
from __future__ import annotations

import re
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import audio_manager
import fs_browser


class AudioMetadataCache:
    """Thread-safe cache for fast ffprobe metadata and EBU R128 QC results."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.qc_results: dict[str, dict] = {}
        self.meta_results: dict[str, dict] = {}

    def put_qc(self, file_path: Path | str, qc_data: dict) -> None:
        with self.lock:
            self.qc_results[str(file_path)] = qc_data

    def rename_entry(self, old_path: Path | str, new_path: Path | str) -> None:
        """Renames a cached file entry in both QC and metadata stores."""
        old_str = str(old_path)
        new_str = str(new_path)
        with self.lock:
            if old_str in self.qc_results:
                self.qc_results[new_str] = self.qc_results.pop(old_str)
            if old_str in self.meta_results:
                self.meta_results[new_str] = self.meta_results.pop(old_str)

    def rename_folder(self, old_folder: Path | str, new_folder: Path | str) -> None:
        """Renames all cached entries matching a playlist/folder prefix."""
        old_prefix = str(old_folder).rstrip("/") + "/"
        new_prefix = str(new_folder).rstrip("/") + "/"
        with self.lock:
            for store in (self.qc_results, self.meta_results):
                keys_to_update = [k for k in store if k == str(old_folder) or k.startswith(old_prefix)]
                for k in keys_to_update:
                    if k == str(old_folder):
                        new_k = str(new_folder)
                    else:
                        new_k = new_prefix + k[len(old_prefix):]
                    store[new_k] = store.pop(k)

    def remove_entry(self, file_path: Path | str) -> None:
        """Removes a deleted file entry from both QC and metadata stores."""
        key = str(file_path)
        with self.lock:
            self.qc_results.pop(key, None)
            self.meta_results.pop(key, None)

    def remove_folder(self, folder_path: Path | str) -> None:
        """Removes all cached entries belonging to a deleted folder prefix."""
        folder_str = str(folder_path)
        prefix = folder_str.rstrip("/") + "/"
        with self.lock:
            for store in (self.qc_results, self.meta_results):
                keys_to_drop = [k for k in store if k == folder_str or k.startswith(prefix)]
                for k in keys_to_drop:
                    store.pop(k, None)

    def update_after_resample(self, out_p: Path, old_p_str: str, overwrite: bool) -> None:
        with self.lock:
            if overwrite and old_p_str != str(out_p):
                self.qc_results.pop(old_p_str, None)
                self.meta_results.pop(old_p_str, None)
        try:
            meta = audio_manager.metadata(out_p)
            meta["_mtime"] = int(out_p.stat().st_mtime)
            with self.lock:
                self.meta_results[str(out_p)] = meta
                if str(out_p) in self.qc_results:
                    self.qc_results[str(out_p)].update(meta)
        except Exception:
            pass

    def probe_files_fast(self, files: list[Path]) -> None:
        """Fast parallel ffprobe metadata check for sample rate, codec, and bitrate."""
        if not shutil.which("ffprobe"):
            return
        to_probe: list[tuple[Path, int]] = []
        for p in files:
            try:
                mtime = int(p.stat().st_mtime)
            except OSError:
                continue
            with self.lock:
                existing = self.meta_results.get(str(p))
            if not existing or existing.get("_mtime") != mtime:
                to_probe.append((p, mtime))

        if not to_probe:
            return

        def _one(item: tuple[Path, int]) -> None:
            path_obj, mtime_val = item
            try:
                meta = audio_manager.metadata(path_obj)
                meta["_mtime"] = mtime_val
                with self.lock:
                    self.meta_results[str(path_obj)] = meta
            except Exception:
                pass

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(_one, to_probe))

    def scan_library(self, inbox_dir: Path) -> list[dict]:
        """Runs full EBU R128 audit on all audio files in inbox_dir recursively."""
        if not inbox_dir.exists():
            return []
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("FFmpeg / FFprobe tidak ditemukan di PATH. Silakan install FFmpeg terlebih dahulu.")

        files = sorted(
            p for p in inbox_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in audio_manager.EXTENSIONS
        )
        audited = []
        for f in files:
            row = audio_manager.audit_one(f)
            self.put_qc(f, row)
            audited.append(row)
        return audited

    def get_library_files(self, base_dir: Path) -> tuple[list[dict], list[dict]]:
        """Returns (files, playlists) in base_dir with merged metadata and cached QC."""
        target_dir = base_dir.resolve()
        if not target_dir.exists() or not target_dir.is_dir():
            return [], []

        playlist_counts: dict[str, dict] = {}
        try:
            top_entries = sorted(target_dir.iterdir(), key=lambda x: x.name.lower())
        except OSError:
            top_entries = []
        for d in top_entries:
            if d.name.startswith(".") or d.name.startswith("$") or d.name in fs_browser.SKIP_SYSTEM_DIRS:
                continue
            try:
                if d.is_dir():
                    playlist_counts[d.name] = {"name": d.name, "total": 0, "mp3_count": 0, "other_count": 0}
            except OSError:
                continue

        items = []
        root_total = 0
        root_mp3 = 0
        for p in fs_browser.iter_audio_files_safe(target_dir):
            try:
                stat = p.stat()
            except OSError:
                continue
            with self.lock:
                qc = self.qc_results.get(str(p))
                meta = self.meta_results.get(str(p))
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
                "qc": merged_qc,
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


def resolve_resample_files(
    source_resolved: Path,
    allowed: set[str],
    rel_paths: list[str] | None,
    rel_path: str | None,
    playlist: str | None,
) -> list[Path]:
    """Resolves the list of audio files to resample within source_resolved."""
    if isinstance(rel_paths, list) and rel_paths:
        files = []
        for rp in rel_paths:
            if isinstance(rp, str) and rp.strip():
                cand = (source_resolved / rp.strip()).resolve()
                if cand.is_relative_to(source_resolved) and cand.is_file() and cand.suffix.lower() in allowed:
                    files.append(cand)
        return files

    if rel_path:
        target_file = (source_resolved / rel_path).resolve()
        return [target_file] if (target_file.is_relative_to(source_resolved) and target_file.is_file()) else []

    if playlist:
        if playlist == "__ROOT__":
            return sorted(
                p for p in source_resolved.iterdir()
                if p.is_file() and p.suffix.lower() in allowed and not p.name.startswith(".")
            )
        pl_dir = (source_resolved / playlist).resolve()
        if pl_dir.is_relative_to(source_resolved) and pl_dir.is_dir():
            return fs_browser.iter_audio_files_safe(pl_dir, allowed)
        return []

    return [
        p for p in fs_browser.iter_audio_files_safe(source_resolved, allowed)
        if not re.search(audio_manager.TAG_FOLDER_PATTERN, p.parent.name)
    ]


class TaskQueueManager:
    """Thread-safe manager for queuing and executing download & SoXR resample jobs."""

    def __init__(
        self,
        metadata_cache: AudioMetadataCache,
        inbox_dir: Path,
        archive_file: Path,
        cookies_file: Path,
    ) -> None:
        self.lock = threading.Lock()
        self.queue: list[dict] = []
        self.current_task: dict | None = None
        self.history: list[dict] = []
        self.metadata_cache = metadata_cache
        self.inbox_dir = inbox_dir
        self.archive_file = archive_file
        self.cookies_file = cookies_file

    def get_snapshot(self, history_limit: int = 10) -> dict:
        with self.lock:
            return {
                "current": self.current_task,
                "queue": list(self.queue),
                "history": list(self.history[:history_limit]),
            }

    @staticmethod
    def append_log(task: dict, message: str) -> None:
        """Appends a log line to task['logs'] while bounding buffer size to 200 entries."""
        logs = task.setdefault("logs", [])
        logs.append(message)
        if len(logs) > 200:
            logs.pop(0)

    def finish_task(
        self,
        task: dict,
        status: str,
        error: str | None = None,
        progress: float | None = None,
        outcome: str | None = None,
        title: str | None = None,
        summary: str | None = None,
        stats: dict | None = None,
    ) -> None:
        """Marks the active task completed/failed and moves it into history under lock."""
        task["status"] = status
        task["outcome"] = outcome or status
        task["finished_at"] = time.time()
        if title is not None:
            task["title"] = title
        if summary is not None:
            task["summary"] = summary
        if stats is not None:
            task["stats"] = stats
        if error is not None:
            task["error"] = error
        if progress is not None:
            task["progress"] = progress
        with self.lock:
            self.history.insert(0, task)
            self.current_task = None

    def enqueue_downloads(self, payload: dict) -> tuple[int, dict]:
        """Validates URLs and enqueues download tasks. Returns (http_status, response_dict)."""
        urls = payload.get("urls", [])
        auto_scan = bool(payload.get("auto_scan", True))
        is_playlist = bool(payload.get("is_playlist", False))
        use_cookies = bool(payload.get("use_cookies", True))
        cookie_browser = str(payload.get("cookie_browser", "chrome")).strip().lower()
        if cookie_browser not in ("chrome", "chromium", "firefox", "brave", "edge", "opera", "vivaldi"):
            cookie_browser = "chrome"

        audio_format = str(payload.get("audio_format", "opus")).lower()
        if audio_format in ("premium", "premium_aac"):  # legacy alias
            audio_format = "opus"
        if audio_format not in ("opus", "native", "mp3_320k", "mp3_vbr0"):
            audio_format = "opus"
        keep_opus = bool(payload.get("keep_opus", False))

        if isinstance(urls, str):
            urls = [line.strip() for line in urls.splitlines() if line.strip()]

        valid_tasks = []
        invalid_count = 0
        duplicate_count = 0
        seen_batch: set[str] = set()
        with self.lock:
            queued_urls = {t.get("url") for t in self.queue if t.get("type") != "resample"}
            if self.current_task and self.current_task.get("type") != "resample":
                queued_urls.add(self.current_task.get("url"))

        for u in urls:
            clean_u = u.strip() if isinstance(u, str) else ""
            if not clean_u:
                continue
            if not fs_browser.validate_url(clean_u):
                invalid_count += 1
                continue
            if clean_u in seen_batch or clean_u in queued_urls:
                duplicate_count += 1
                continue
            seen_batch.add(clean_u)
            valid_tasks.append({
                "id": f"job_{int(time.time() * 1000)}_{len(valid_tasks)}",
                "type": "download",
                "url": clean_u,
                "status": "QUEUED",
                "auto_scan": auto_scan,
                "is_playlist": is_playlist,
                "audio_format": audio_format,
                "keep_opus": keep_opus,
                "use_cookies": use_cookies,
                "cookie_browser": cookie_browser,
                "progress": 0,
                "created_at": time.time(),
            })

        if not valid_tasks:
            if duplicate_count > 0 and invalid_count == 0:
                return 400, {
                    "error": "URL tersebut sudah berada di dalam antrian unduhan yang sedang berjalan.",
                    "duplicate_count": duplicate_count,
                }
            return 400, {
                "error": "Tidak ada URL YouTube yang valid. Pastikan domain youtube.com / youtu.be.",
                "invalid_count": invalid_count,
            }

        with self.lock:
            self.queue.extend(valid_tasks)

        extra_notes = []
        if duplicate_count > 0:
            extra_notes.append(f"{duplicate_count} URL duplikat diabaikan")
        if invalid_count > 0:
            extra_notes.append(f"{invalid_count} URL tidak valid dilewati")
        suffix = f" ({', '.join(extra_notes)})" if extra_notes else ""

        return 200, {
            "message": f"Berhasil menambahkan {len(valid_tasks)} item ke antrian{suffix}.",
            "added_count": len(valid_tasks),
            "duplicate_count": duplicate_count,
            "invalid_count": invalid_count,
        }

    def enqueue_resample(self, payload: dict) -> tuple[int, dict]:
        """Validates parameters and enqueues a resample or lossless remux job. Returns (http_status, response_dict)."""
        mode = str(payload.get("mode", "resample")).strip().lower()
        if mode not in ("resample", "remux_opus"):
            mode = "resample"
        is_remux = (mode == "remux_opus")

        target_rate = int(payload.get("target_rate", 44100))
        if not is_remux and target_rate not in (44100, 48000):
            return 400, {"error": "Target sample rate hanya mendukung 44100 atau 48000 Hz."}

        target_bitrate = int(payload.get("target_bitrate", 320))
        if not is_remux and target_bitrate not in audio_manager.ALLOWED_BITRATES:
            return 400, {"error": "Target bitrate hanya mendukung 320, 192, 128, atau 96 kbps."}

        raw_source_dir = payload.get("source_dir")
        raw_dest_dir = payload.get("dest_dir")
        try:
            source_resolved = (
                fs_browser.resolve_safe_dir(raw_source_dir, self.inbox_dir, must_exist=True)
                if raw_source_dir
                else self.inbox_dir.resolve()
            )
            dest_resolved = (
                fs_browser.resolve_safe_dir(raw_dest_dir, self.inbox_dir, must_exist=False)
                if (isinstance(raw_dest_dir, str) and raw_dest_dir.strip())
                else None
            )
        except Exception as exc:
            return 400, {"error": str(exc)}

        rel_path = payload.get("rel_path")
        rel_paths = payload.get("rel_paths")
        playlist = payload.get("playlist")
        only_mp3 = bool(payload.get("only_mp3", False))
        overwrite = bool(payload.get("overwrite", False))
        spec_str = ".opus (Lossless Remux)" if is_remux else f"{target_rate} Hz • {target_bitrate} kbps"
        verb = "Remux" if is_remux else "Konversi"

        if isinstance(rel_paths, list) and rel_paths:
            valid_rels = []
            for rp in rel_paths:
                if isinstance(rp, str) and rp.strip():
                    cand = (source_resolved / rp.strip()).resolve()
                    if cand.is_relative_to(source_resolved) and cand.is_file():
                        valid_rels.append(rp.strip())
            if not valid_rels:
                return 400, {"error": "Tidak ada file valid yang dipilih."}
            label = f"{verb} {len(valid_rels)} Lagu Terpilih -> {spec_str}"
            rel_paths = valid_rels
        elif rel_path is not None:
            if not isinstance(rel_path, str) or not rel_path.strip():
                return 400, {"error": "Path file tidak valid."}
            rel_path = rel_path.strip()
            candidate = (source_resolved / rel_path).resolve()
            if not candidate.is_relative_to(source_resolved) or not candidate.is_file():
                return 404, {"error": "File audio tidak ditemukan di folder sumber."}
            label = f"{verb} {candidate.name} -> {spec_str}"
        elif isinstance(playlist, str) and playlist.strip():
            playlist = playlist.strip()
            if playlist != "__ROOT__":
                pl_dir = (source_resolved / playlist).resolve()
                if not pl_dir.is_relative_to(source_resolved) or not pl_dir.is_dir():
                    return 404, {"error": "Folder playlist tidak ditemukan."}
            pl_name = "Root Folder" if playlist == "__ROOT__" else playlist
            scope_label = "WebM/Opus" if is_remux else ("MP3" if only_mp3 else "Semua Lagu")
            label = f"{verb} Playlist '{pl_name}' ({scope_label}) -> {spec_str}"
        else:
            scope_label = "Semua WebM/Opus" if is_remux else ("Semua MP3" if only_mp3 else "Semua File")
            label = f"{verb} Folder '{source_resolved.name}' ({scope_label}) -> {spec_str}"

        job = {
            "id": f"resample_{int(time.time() * 1000)}",
            "type": "resample",
            "mode": mode,
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
        with self.lock:
            self.queue.append(job)

        return 200, {
            "message": f"Tugas ({label}) ditambahkan ke antrian.",
            "job_id": job["id"],
        }

    def execute_resample_task(self, task: dict) -> None:
        """Executes a batch or single-file SoXR sample-rate conversion or Lossless Opus Remux task."""
        mode = str(task.get("mode", "resample")).lower()
        is_remux = (mode == "remux_opus")
        target_rate = int(task.get("target_rate", 44100))
        target_bitrate = int(task.get("target_bitrate", 320))
        rel_path = task.get("rel_path")
        rel_paths = task.get("rel_paths")
        playlist = task.get("playlist")
        only_mp3 = bool(task.get("only_mp3", False))
        overwrite = bool(task.get("overwrite", False))
        raw_source_dir = task.get("source_dir")
        raw_dest_dir = task.get("dest_dir")
        rate_label = "44.1 kHz" if target_rate == 44100 else f"{target_rate} Hz"
        spec_label = ".opus (Lossless Remux)" if is_remux else f"{rate_label} • {target_bitrate} kbps"

        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            err_msg = "FFmpeg / FFprobe belum terinstall di PATH sistem."
            self.finish_task(
                task,
                "FAILED",
                error=err_msg,
                outcome="FAILED",
                title="Konversi Gagal (FFmpeg Missing)",
                summary=err_msg,
            )
            return

        try:
            source_resolved = fs_browser.resolve_safe_dir(raw_source_dir, self.inbox_dir, must_exist=True)
            dest_resolved = (
                fs_browser.resolve_safe_dir(raw_dest_dir, self.inbox_dir, must_exist=False)
                if (raw_dest_dir and str(raw_dest_dir).strip())
                else None
            )
        except Exception as dir_exc:
            self.append_log(task, f"[RESAMPLE ERROR] {dir_exc}")
            self.finish_task(
                task,
                "FAILED",
                error=str(dir_exc),
                outcome="FAILED",
                title="Konversi Gagal (Folder Tidak Valid)",
                summary=str(dir_exc),
            )
            return

        allowed = {".webm", ".ogg"} if is_remux else ({".mp3"} if only_mp3 else audio_manager.EXTENSIONS)
        files = resolve_resample_files(source_resolved, allowed, rel_paths, rel_path, playlist)
        total = len(files)
        if total == 0:
            msg = (
                "Tidak ditemukan file .webm/.ogg yang cocok untuk di-remux ke .opus pada pilihan ini."
                if is_remux
                else "Tidak ditemukan file audio yang cocok untuk dikonversi pada pilihan ini."
            )
            self.append_log(task, f"[{'REMUX' if is_remux else 'RESAMPLE'}] {msg}")
            self.finish_task(
                task,
                "SUCCESS",
                progress=100,
                outcome="WARNING",
                title="Tidak Ada File yang Cocok",
                summary=msg,
                stats={"converted": 0, "skipped": 0, "errors": 0},
            )
            return

        mode_desc = "OVERWRITE" if overwrite else (f"TUJUAN: {dest_resolved}" if dest_resolved else "SALIN BARU OTOMATIS")
        if is_remux:
            self.append_log(
                task,
                f"[REMUX OPUS] Memulai Lossless Remux (.webm -> .opus, -c:a copy) [{mode_desc}] ({total} file)...",
            )
        else:
            self.append_log(
                task,
                f"[RESAMPLE] Memulai konversi ke {target_rate} Hz • {target_bitrate} kbps [{mode_desc}] ({total} file)...",
            )
        converted_count = 0
        skipped_count = 0
        error_count = 0
        last_converted_name = ""

        for idx, fpath in enumerate(files, 1):
            task["progress"] = min(99, round(((idx - 1) / total) * 100))
            try:
                file_out_dir = None
                if dest_resolved is not None:
                    rel_parent = fpath.parent.relative_to(source_resolved)
                    file_out_dir = dest_resolved / rel_parent if rel_parent != Path(".") else dest_resolved

                if is_remux:
                    res = audio_manager.remux_to_opus_one(
                        fpath,
                        overwrite=overwrite,
                        out_dir=file_out_dir,
                    )
                else:
                    res = audio_manager.resample_one(
                        fpath,
                        target_rate=target_rate,
                        target_bitrate=target_bitrate,
                        overwrite=overwrite,
                        out_dir=file_out_dir,
                    )
                if res["status"] == "CONVERTED":
                    converted_count += 1
                    last_converted_name = fpath.name
                    self.append_log(task, f"[{idx}/{total}] CONVERTED: {res['message']}")
                    out_p = Path(res["file"])
                    old_p_str = res.get("old_file", str(fpath))
                    self.metadata_cache.update_after_resample(out_p, old_p_str, overwrite)
                else:
                    skipped_count += 1
                    self.append_log(task, f"[{idx}/{total}] SKIPPED: {fpath.name} ({res['message']})")
            except Exception as exc:
                error_count += 1
                self.append_log(task, f"[{idx}/{total}] ERROR {fpath.name}: {exc}")

        tag_done = "REMUX SELESAI" if is_remux else "RESAMPLE SELESAI"
        self.append_log(
            task,
            f"[{tag_done}] Dikonversi: {converted_count} | Dilewati: {skipped_count} | Error: {error_count}",
        )

        stats = {"converted": converted_count, "skipped": skipped_count, "errors": error_count}
        if error_count == 0 and converted_count == 0 and skipped_count > 0:
            outcome = "ALREADY_EXISTS"
            title = "File Sudah Sesuai Target (Dilewati)"
            summary = (
                f"Lagu '{files[0].name}' sudah berformat {spec_label} atau sudah ada di folder tujuan."
                if skipped_count == 1
                else f"Seluruh {skipped_count} lagu yang dipilih sudah berformat {spec_label} (dilewati otomatis)."
            )
        elif error_count == 0 and converted_count > 0:
            outcome = "SUCCESS"
            title = "Lossless Remux .opus Selesai" if is_remux else "Konversi SoXR Selesai"
            if converted_count == 1 and skipped_count == 0:
                summary = f"Berhasil mengubah '{last_converted_name}' ke {spec_label}."
            elif skipped_count > 0:
                summary = f"Berhasil mengubah {converted_count} lagu ke {spec_label} ({skipped_count} dilewati karena sudah sesuai)."
            else:
                summary = f"Berhasil mengubah {converted_count} lagu ke {spec_label}."
        elif converted_count > 0 and error_count > 0:
            outcome = "WARNING"
            title = "Proses Selesai Sebagian"
            summary = f"{converted_count} lagu berhasil dikonversi ke {spec_label}, {error_count} gagal, {skipped_count} dilewati."
        else:
            outcome = "FAILED"
            title = "Konversi Gagal"
            summary = f"Gagal mengonversi {error_count} file audio. Periksa log terminal untuk detail."

        self.finish_task(
            task,
            "SUCCESS" if error_count == 0 else "FAILED",
            progress=100,
            outcome=outcome,
            title=title,
            summary=summary,
            stats=stats,
        )

    def execute_download_task(self, task: dict) -> None:
        """Executes a yt-dlp audio ingestion task and optional EBU R128 QC scan."""
        url = task["url"]
        auto_scan = task.get("auto_scan", True)

        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.archive_file.parent.mkdir(parents=True, exist_ok=True)

        if not shutil.which("yt-dlp"):
            err_msg = "yt-dlp belum terinstall di sistem. Jalankan: pip install yt-dlp"
            self.finish_task(
                task,
                "FAILED",
                error=err_msg,
                progress=0,
                outcome="FAILED",
                title="Unduhan Gagal (yt-dlp Missing)",
                summary=err_msg,
            )
            return

        audio_format = task.get("audio_format", "opus")
        if audio_format in ("premium", "premium_aac"):
            audio_format = "opus"
        keep_opus = bool(task.get("keep_opus", False))
        is_playlist = bool(task.get("is_playlist", False))
        use_cookies = bool(task.get("use_cookies", True))
        cookie_browser = str(task.get("cookie_browser", "chrome")).lower()

        if is_playlist:
            template = str(self.inbox_dir / "%(playlist_title,playlist|Playlist)s" / "%(title).150B [%(id)s].%(ext)s")
        else:
            template = str(self.inbox_dir / "%(title).150B [%(id)s].%(ext)s")

        removed_stale = audio_manager.sync_download_archive(self.inbox_dir, self.archive_file, audio_format, keep_opus)
        if removed_stale > 0:
            self.append_log(
                task,
                f"[ARCHIVE SYNC] Membersihkan {removed_stale} ID riwayat lama di downloaded_ids.txt yang file targetnya belum ada di inbox.",
            )

        js_runtime, run_env = audio_manager.find_js_runtime()
        downloaded_files_before = set(p for p in self.inbox_dir.rglob("*") if p.is_file())
        existing_by_vid: dict[str, str] = {}
        for p in downloaded_files_before:
            if p.suffix.lower() in audio_manager.EXTENSIONS:
                m_vid = re.search(r"\[([A-Za-z0-9_-]{11})\]$", p.stem)
                if m_vid:
                    existing_by_vid[m_vid.group(1)] = p.name

        attempts = [True, False] if use_cookies else [False]
        success = False
        final_code = 0
        skipped_files: list[str] = []
        last_error_line = ""

        for try_idx, with_cookies in enumerate(attempts):
            cmd, target_desc = audio_manager.build_ytdlp_command(
                url=url,
                output_template=template,
                archive_file=self.archive_file,
                audio_format=audio_format,
                keep_opus=keep_opus,
                is_playlist=is_playlist,
                cookies_file=self.cookies_file if (with_cookies and self.cookies_file.is_file()) else None,
                cookie_browser=cookie_browser if (with_cookies and not self.cookies_file.is_file()) else None,
                js_runtime=js_runtime,
            )
            if try_idx > 0:
                self.append_log(
                    task,
                    f"[AUTH FALLBACK] Sesi {cookie_browser} bermasalah/terkunci. Beralih otomatis ke Fallback Mode Publik...",
                )
            self.append_log(task, target_desc)
            self.append_log(task, f"Starting extraction for: {url}")

            try:
                run_res = audio_manager.run_ytdlp_process(
                    cmd,
                    env=run_env,
                    existing_by_vid=existing_by_vid,
                    on_log=lambda msg: self.append_log(task, msg),
                    on_progress=lambda pct: task.__setitem__("progress", pct),
                )
                skipped_files = run_res["skipped_files"]
                last_error_line = run_res["last_error_line"]
                if run_res["returncode"] == 0:
                    success = True
                    break
                final_code = run_res["returncode"]
                if with_cookies and (run_res["cookie_err_detected"] or len(attempts) > try_idx + 1):
                    continue
                break
            except Exception as proc_exc:
                self.append_log(task, f"Execution error: {proc_exc}")
                last_error_line = str(proc_exc)
                final_code = 1
                if with_cookies and len(attempts) > try_idx + 1:
                    continue
                break

        downloaded_files_after = set(p for p in self.inbox_dir.rglob("*") if p.is_file())
        new_files = sorted(
            [
                f for f in downloaded_files_after
                if f not in downloaded_files_before and f.suffix.lower() in audio_manager.EXTENSIONS
            ],
            key=lambda x: x.name,
        )
        clipping_count = 0

        if new_files and auto_scan and shutil.which("ffmpeg") and shutil.which("ffprobe"):
            self.append_log(task, "Initiating audio QC audit (EBU R128 & True Peak)...")
            for nf in new_files:
                try:
                    qc_data = audio_manager.audit_one(nf)
                    self.metadata_cache.put_qc(nf, qc_data)
                    tp_val = audio_manager.get_float(qc_data.get("true_peak_dbtp"))
                    if tp_val is not None and tp_val > 0:
                        clipping_count += 1
                    self.append_log(task, f"QC completed: {nf.name} [Status: {qc_data.get('status')}]")
                except Exception as qc_err:
                    self.append_log(task, f"QC error on {nf.name}: {qc_err}")

        dl_count = len(new_files)
        skip_count = len(skipped_files)
        stats = {"downloaded": dl_count, "skipped": skip_count, "clipping": clipping_count}

        if success:
            self.append_log(task, "Extraction finished successfully.")
            if dl_count == 0 and skip_count > 0:
                outcome = "ALREADY_EXISTS"
                title = "File Sudah Ada di Library"
                summary = (
                    f"Lagu sudah ada di Library dan dilewati otomatis: {skipped_files[0]}"
                    if skip_count == 1
                    else f"Seluruh {skip_count} lagu pada URL ini sudah ada di Library (dilewati otomatis)."
                )
            elif dl_count == 0 and skip_count == 0:
                outcome = "ALREADY_EXISTS"
                title = "File Sudah Ada di Library"
                summary = "Tidak ada file audio baru yang diunduh karena file sudah tersedia di Inbox."
            elif dl_count > 0 and skip_count > 0:
                outcome = "WARNING" if clipping_count > 0 else "PARTIAL"
                title = "Unduhan Selesai (Sebagian Sudah Ada)"
                qc_note = f" • ⚠️ {clipping_count} lagu terdeteksi Clipping Hazard (> 0 dBTP)!" if clipping_count > 0 else ""
                summary = f"{dl_count} lagu baru berhasil diunduh, {skip_count} lagu dilewati karena sudah ada di Library.{qc_note}"
            else:
                outcome = "WARNING" if clipping_count > 0 else "SUCCESS"
                title = "Unduhan & QC Selesai (Perhatian Headroom)" if clipping_count > 0 else "Unduhan Selesai"
                base_msg = (
                    f"Berhasil mengunduh: {new_files[0].name}"
                    if dl_count == 1
                    else f"Berhasil mengunduh {dl_count} file audio baru ke Inbox."
                )
                qc_note = f" • ⚠️ {clipping_count} lagu memiliki True Peak > 0 dBTP (Clipping Hazard)." if clipping_count > 0 else ""
                summary = base_msg + qc_note

            self.finish_task(
                task,
                "SUCCESS",
                progress=100,
                outcome=outcome,
                title=title,
                summary=summary,
                stats=stats,
            )
        else:
            err_short = last_error_line[:140] if last_error_line else f"yt-dlp exited with code {final_code}"
            if dl_count > 0:
                outcome = "WARNING"
                title = "Unduhan Selesai Sebagian (Ada Error)"
                summary = f"{dl_count} lagu berhasil diunduh, namun ada item yang gagal ({err_short})."
            elif skip_count > 0 and not last_error_line:
                outcome = "ALREADY_EXISTS"
                title = "File Sudah Ada di Library"
                summary = f"{skip_count} lagu dilewati karena sudah ada di Library."
            else:
                outcome = "FAILED"
                title = "Unduhan Gagal"
                summary = f"Gagal mengunduh dari URL: {err_short}"

            self.finish_task(
                task,
                "FAILED",
                error=err_short,
                outcome=outcome,
                title=title,
                summary=summary,
                stats=stats,
            )

    def run_worker_loop(self) -> None:
        """Background worker processing tasks from self.queue sequentially."""
        while True:
            task = None
            with self.lock:
                if self.queue:
                    task = self.queue.pop(0)
                    self.current_task = task
                else:
                    self.current_task = None

            if not task:
                time.sleep(1)
                continue

            task["status"] = "PROCESSING"
            task["logs"] = []
            task["progress"] = 0

            if task.get("type") == "resample":
                self.execute_resample_task(task)
            else:
                self.execute_download_task(task)

