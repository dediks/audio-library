#!/usr/bin/env python3
"""Filesystem Browser, Path Boundary Validation & URL Allowlist Helpers."""
from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse

import audio_manager

BASE_DIR = Path(__file__).resolve().parent
INBOX_DIR = BASE_DIR / "library" / "inbox"

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

ALLOWED_YOUTUBE_DOMAINS = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
)


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


def resolve_safe_dir(raw_path: str | None, default_dir: Path = INBOX_DIR, must_exist: bool = True) -> Path:
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


def get_windows_shortcuts(default_inbox: Path = INBOX_DIR) -> list[dict]:
    """Builds quick-access shortcuts for WSL + Windows drives and the active Windows user folders."""
    shortcuts = [
        {"label": "📥 Inbox Proyek", "path": str(default_inbox.resolve())},
        {"label": "🏠 WSL Home", "path": str(Path.home().resolve())},
    ]
    wsl_music = Path.home() / "Music"
    if wsl_music.is_dir():
        shortcuts.append({"label": "🎵 WSL Music", "path": str(wsl_music.resolve())})

    mnt_root = Path("/mnt")
    if mnt_root.is_dir():
        win_users_dir = mnt_root / "c" / "Users"
        if win_users_dir.is_dir():
            skip_users = {
                "public",
                "default",
                "default user",
                "all users",
                "wsiaccount",
                "wdagutilityaccount",
                "administrator",
                "guest",
            }
            candidate_users: list[tuple[float, Path]] = []
            try:
                for udir in sorted(win_users_dir.iterdir()):
                    name_low = udir.name.lower()
                    if (
                        udir.name.startswith(".")
                        or name_low in skip_users
                        or name_low.startswith("defaultuser")
                        or name_low.startswith("temp")
                    ):
                        continue
                    try:
                        if not udir.is_dir():
                            continue
                        latest_mtime = udir.stat().st_mtime
                        for probe_sub in ("Downloads", "Desktop", "Music", "NTUSER.DAT"):
                            sp = udir / probe_sub
                            try:
                                if sp.exists():
                                    latest_mtime = max(latest_mtime, sp.stat().st_mtime)
                            except OSError:
                                pass
                        candidate_users.append((latest_mtime, udir))
                    except OSError:
                        continue
            except OSError:
                pass

            if candidate_users:
                candidate_users.sort(key=lambda item: item[0], reverse=True)
                primary_udir = candidate_users[0][1]
                shortcuts.append({"label": f"🪟 Win User ({primary_udir.name})", "path": str(primary_udir)})
                for sub_label, sub_name in (
                    ("🎵 Win Music", "Music"),
                    ("⬇️ Win Downloads", "Downloads"),
                    ("🖥️ Win Desktop", "Desktop"),
                ):
                    sub_p = primary_udir / sub_name
                    try:
                        if sub_p.is_dir():
                            shortcuts.append({"label": sub_label, "path": str(sub_p)})
                    except OSError:
                        pass

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


def browse_directory(
    raw_path: str | None,
    create_subfolder: str | None = None,
    default_inbox: Path = INBOX_DIR,
) -> dict:
    """Resolves a directory, optionally creates a sanitized subfolder, and lists subdirectories."""
    curr_dir = resolve_safe_dir(raw_path, default_inbox, must_exist=True)
    if isinstance(create_subfolder, str) and create_subfolder.strip():
        clean_sub = re.sub(r'[<>:"/\\|?*]', "", create_subfolder.strip())
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
            continue
        subdirs.append({"name": d.name, "path": str(d), "audio_count": audio_cnt})

    return {
        "current": str(curr_dir),
        "parent": parent_path,
        "dirs": subdirs,
        "subdirs": subdirs,
        "shortcuts": get_windows_shortcuts(default_inbox),
    }


def validate_url(url_str: str) -> bool:
    """Strictly validates input URL for allowed scheme and YouTube domain."""
    if not url_str or not isinstance(url_str, str):
        return False
    try:
        parsed = urlparse(url_str.strip())
        if parsed.scheme not in ("http", "https"):
            return False
        netloc = parsed.netloc.lower()
        return any(netloc == domain or netloc.endswith("." + domain) for domain in ALLOWED_YOUTUBE_DOMAINS)
    except Exception:
        return False

