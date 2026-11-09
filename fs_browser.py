#!/usr/bin/env python3
"""Filesystem Browser, Path Boundary Validation & URL Allowlist Helpers."""
from __future__ import annotations

import json
import os
import re
import shutil
import string
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import audio_manager


def _determine_app_dirs() -> tuple[Path, Path]:
    """Returns (RESOURCE_DIR, BASE_DIR) supporting normal execution and PyInstaller frozen bundles."""
    here = Path(__file__).resolve().parent
    if getattr(sys, "frozen", False):
        resource_dir = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent)).resolve()
        exe_dir = Path(sys.executable).resolve().parent
        candidates = [
            exe_dir,
            (Path.home() / "SwarariaAudioLab").resolve(),
            here,
            Path("/tmp/SwarariaAudioLab").resolve(),
        ]
        for cand in candidates:
            try:
                (cand / "library" / "inbox").mkdir(parents=True, exist_ok=True)
                probe_file = cand / "library" / ".write_test"
                probe_file.write_text("ok", encoding="utf-8")
                probe_file.unlink(missing_ok=True)
                return resource_dir, cand
            except OSError:
                continue
        return resource_dir, exe_dir

    try:
        (here / "library" / "inbox").mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return here, here


RESOURCE_DIR, BASE_DIR = _determine_app_dirs()
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
    roots = [BASE_DIR.resolve(), RESOURCE_DIR.resolve(), Path.home().resolve()]
    if os.name == "nt":
        for letter in string.ascii_uppercase:
            drive_root = Path(f"{letter}:\\")
            try:
                if drive_root.exists():
                    roots.append(drive_root.resolve())
            except OSError:
                pass
    else:
        for extra in ("/tmp", "/media", "/mnt", "/run/media", "/Volumes"):
            ep = Path(extra)
            try:
                if ep.exists():
                    roots.append(ep.resolve())
            except OSError:
                pass
    return roots


def normalize_windows_or_wsl_path(raw_path: str) -> str:
    """Normalizes paths across Native Windows, WSL (/mnt/<drive>), and POSIX systems."""
    cleaned = raw_path.strip().strip('"').strip("'")
    if os.name == "nt":
        mnt_match = re.match(r"^/mnt/([a-zA-Z])(?:/(.*))?$", cleaned)
        if mnt_match:
            drive = mnt_match.group(1).upper()
            rest = (mnt_match.group(2) or "").replace("/", "\\")
            return f"{drive}:\\{rest}" if rest else f"{drive}:\\"
        return cleaned

    win_match = re.match(r"^([a-zA-Z]):(?:[\\/](.*))?$", cleaned)
    if win_match:
        drive = win_match.group(1).lower()
        rest = (win_match.group(2) or "").replace("\\", "/").strip("/")
        wsl_drive = Path(f"/mnt/{drive}")
        if wsl_drive.exists():
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
        raise ValueError(f"Folder access denied (outside Home / Windows /mnt / Media / Project): {resolved}")

    rel_parts = resolved.relative_to(matched_root).parts
    if any(part.startswith(".") for part in rel_parts):
        raise ValueError("Access to hidden system folders (dot-folders) is not allowed.")

    if must_exist and not resolved.is_dir():
        raise ValueError(f"Folder not found: {resolved}")
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
    """Builds quick-access shortcuts for Native Windows, macOS, Linux, and WSL environments."""
    home_dir = Path.home().resolve()
    shortcuts = [
        {"label": "📥 Inbox Proyek", "path": str(default_inbox.resolve())},
        {"label": "🏠 Home User" if os.name == "nt" else "🏠 WSL/Linux Home", "path": str(home_dir)},
    ]

    for sub_label, sub_name in (
        ("🎵 Music", "Music"),
        ("⬇️ Downloads", "Downloads"),
        ("🖥️ Desktop", "Desktop"),
    ):
        sub_p = home_dir / sub_name
        try:
            if sub_p.is_dir():
                shortcuts.append({"label": sub_label, "path": str(sub_p.resolve())})
        except OSError:
            pass

    if os.name == "nt":
        for letter in string.ascii_uppercase:
            drive_p = Path(f"{letter}:\\")
            try:
                if drive_p.exists():
                    shortcuts.append({
                        "label": f"💽 Drive {letter}:",
                        "path": str(drive_p.resolve()),
                    })
            except OSError:
                pass
        return shortcuts

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

    for m_root in ("/media", "/run/media", "/Volumes"):
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
            media_exts = audio_manager.EXTENSIONS | {".mp4", ".mkv", ".mov", ".ts", ".m4v", ".avi", ".rf64", ".w64"}
            audio_cnt = sum(
                1 for f in d.iterdir()
                if not f.name.startswith(".") and f.suffix.lower() in media_exts and f.is_file()
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


def to_windows_path(linux_path: Path | str) -> str:
    """Converts a Linux/WSL path to a Windows-compatible path (or returns native Windows path)."""
    p_str = str(linux_path).strip()
    if os.name == "nt":
        return str(Path(p_str).resolve())

    wslpath_bin = shutil.which("wslpath")
    if wslpath_bin:
        try:
            res = subprocess.run([wslpath_bin, "-w", p_str], capture_output=True, text=True, timeout=3)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
        except Exception:
            pass

    # Fallback 1: Drive mapping for /mnt/<letter>/...
    mnt_match = re.match(r"^/mnt/([a-zA-Z])(?:/(.*))?$", p_str)
    if mnt_match:
        drive = mnt_match.group(1).upper()
        rest = (mnt_match.group(2) or "").replace("/", "\\")
        return f"{drive}:\\{rest}" if rest else f"{drive}:\\"

    # Fallback 2: UNC path for WSL2 distro
    distro = os.environ.get("WSL_DISTRO_NAME", "Ubuntu")
    win_rest = p_str.replace("/", "\\")
    return f"\\\\wsl.localhost\\{distro}{win_rest}"


def open_in_file_manager(target_path: Path) -> tuple[bool, str]:
    """Opens a directory or highlights a file in Windows File Explorer (or host file manager)."""
    if not target_path.exists():
        return False, f"Path not found on this system: {target_path}"

    win_path = to_windows_path(target_path)

    # Native Windows fast path
    if os.name == "nt" and target_path.is_dir() and hasattr(os, "startfile"):
        try:
            os.startfile(str(target_path))  # type: ignore[attr-defined]
            return True, f"Membuka di Windows Explorer: {win_path}"
        except Exception:
            pass

    # 1. Search for explorer.exe or Windows launch binaries in PATH and standard locations
    explorer_candidates = [
        shutil.which("explorer.exe"),
        "/mnt/c/Windows/explorer.exe",
        "/mnt/c/WINDOWS/explorer.exe",
    ]
    explorer_bin = next((b for b in explorer_candidates if b and os.path.isfile(b) and os.access(b, os.X_OK)), None)

    if explorer_bin:
        try:
            if target_path.is_dir():
                subprocess.Popen(
                    [explorer_bin, "."],
                    cwd=str(target_path),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                subprocess.Popen(
                    [explorer_bin, f"/select,{win_path}"],
                    cwd=str(target_path.parent),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            return True, f"Membuka di Windows Explorer: {win_path}"
        except Exception as exc:
            return False, f"Gagal menjalankan explorer.exe: {exc}"

    # 2. Try PowerShell Start-Process
    ps_candidates = [
        shutil.which("powershell.exe"),
        "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe",
    ]
    ps_bin = next((b for b in ps_candidates if b and os.path.isfile(b) and os.access(b, os.X_OK)), None)
    if ps_bin:
        try:
            cmd = f"Start-Process explorer.exe -ArgumentList '{win_path}'"
            subprocess.Popen([ps_bin, "-NoProfile", "-Command", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True, f"Membuka via PowerShell: {win_path}"
        except Exception as exc:
            pass

    # 3. Try xdg-open for Linux desktops
    xdg_bin = shutil.which("xdg-open")
    if xdg_bin:
        try:
            subprocess.Popen([xdg_bin, str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True, f"Membuka via xdg-open: {target_path}"
        except Exception as exc:
            return False, f"Gagal menjalankan xdg-open: {exc}"

    # 4. Try macOS open
    mac_open = shutil.which("open")
    if mac_open:
        try:
            subprocess.Popen([mac_open, str(target_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True, f"Membuka via open: {target_path}"
        except Exception as exc:
            return False, f"Gagal menjalankan open: {exc}"

    return False, "Could not find explorer.exe or a file manager on the host system."


FORBIDDEN_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_entry_name(name: str) -> str:
    """Sanitizes a proposed filename or folder name."""
    clean = name.strip()
    if not clean:
        raise ValueError("Name must not be empty.")
    if clean in (".", "..") or clean.startswith("."):
        raise ValueError("Name must not start with a dot (.) or be a hidden name.")
    if FORBIDDEN_NAME_CHARS.search(clean):
        raise ValueError('Name contains invalid characters (< > : " / \\ | ? * or control characters).')
    if len(clean) > 255:
        raise ValueError("Name is too long (maximum 255 characters).")
    return clean


def _is_same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def rename_fs_entry(
    source_dir: Path,
    rel_path: str,
    new_name: str,
    is_folder: bool | None = None,
) -> tuple[bool, str, Path, Path]:
    """Safely renames an audio file or a subfolder within source_dir.

    Returns:
        tuple[bool, message, old_resolved_path, new_resolved_path]
    """
    if not rel_path or not isinstance(rel_path, str):
        return False, "Invalid source file/folder path.", Path(), Path()

    clean_new_name = sanitize_entry_name(new_name)

    base = source_dir.resolve()
    target_path = (base / rel_path.strip().lstrip("/\\")).resolve()
    if not target_path.is_relative_to(base):
        return False, "Path access denied (outside the source directory).", Path(), Path()
    if not target_path.exists():
        return False, f"File or folder not found: {rel_path}", Path(), Path()

    target_is_dir = target_path.is_dir() if is_folder is None else bool(is_folder)
    parent_dir = target_path.parent

    if target_is_dir:
        new_path = (parent_dir / clean_new_name).resolve()
        if not new_path.is_relative_to(base):
            return False, "Path access denied while resolving the destination folder.", Path(), Path()
        if new_path.name == target_path.name:
            return True, "Folder name is unchanged.", target_path, new_path
        if new_path.exists() and not _is_same_file(new_path, target_path):
            return False, f"A folder named '{clean_new_name}' already exists.", Path(), Path()
    else:
        orig_ext = target_path.suffix.lower()
        if not clean_new_name.lower().endswith(orig_ext):
            clean_new_name = f"{clean_new_name}{orig_ext}"

        new_path = (parent_dir / clean_new_name).resolve()
        if not new_path.is_relative_to(base):
            return False, "Path access denied while resolving the destination file.", Path(), Path()
        if new_path.name == target_path.name:
            return True, "File name is unchanged.", target_path, new_path
        if new_path.exists() and not _is_same_file(new_path, target_path):
            return False, f"A file named '{clean_new_name}' already exists.", Path(), Path()

    try:
        if new_path.exists():
            # Case-only rename on a case-insensitive filesystem: go through a temp name.
            tmp_p = target_path.with_name(f".swararia_case_tmp_{os.getpid()}{target_path.suffix}")
            target_path.rename(tmp_p)
            try:
                tmp_p.rename(new_path)
            except OSError:
                tmp_p.rename(target_path)
                raise
        else:
            target_path.rename(new_path)
        msg = f"Renamed successfully to '{new_path.name}'"
        return True, msg, target_path, new_path
    except OSError as exc:
        return False, f"Rename failed on the file system: {exc}", Path(), Path()


SAFE_COMPANION_EXTS = {
    ".part", ".ytdl", ".jpg", ".jpeg", ".png", ".webp",
    ".json", ".txt", ".csv", ".lrc", ".m3u", ".m3u8",
}


def delete_fs_entries(
    source_dir: Path,
    rel_paths: list[str] | None = None,
    rel_path: str | None = None,
    is_folder: bool | None = None,
) -> tuple[bool, str, list[Path], list[Path]]:
    """Safely deletes one or more audio files or a playlist subfolder within source_dir.

    Returns:
        tuple[bool, message, deleted_file_paths, deleted_folder_paths]
    """
    base = source_dir.resolve()
    allowed_roots = get_allowed_roots()
    if not any(base.is_relative_to(r) for r in allowed_roots):
        return False, "Source directory access denied.", [], []

    raw_targets: list[str] = []
    if isinstance(rel_paths, list):
        for rp in rel_paths:
            if isinstance(rp, str) and rp.strip():
                raw_targets.append(rp.strip())
    if isinstance(rel_path, str) and rel_path.strip():
        raw_targets.append(rel_path.strip())

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_targets: list[str] = []
    for t in raw_targets:
        if t not in seen:
            seen.add(t)
            unique_targets.append(t)

    if not unique_targets:
        return False, "No files or folders selected for deletion.", [], []

    validated_paths: list[Path] = []
    for raw_rel in unique_targets:
        clean_rel = raw_rel.strip().lstrip("/\\")
        if not clean_rel or clean_rel in (".", ".."):
            return False, "Invalid file/folder path.", [], []
        target_path = (base / clean_rel).resolve()
        if not target_path.is_relative_to(base) or target_path == base:
            return False, "Path access denied (outside the source directory).", [], []
        rel_parts = target_path.relative_to(base).parts
        if any(p.startswith(".") or p.startswith("$") or p in SKIP_SYSTEM_DIRS for p in rel_parts):
            return False, "Deleting system or hidden files/folders is not allowed.", [], []
        if target_path.is_symlink():
            return False, "Deleting symbolic links is not allowed.", [], []
        validated_paths.append(target_path)

    deleted_files: list[Path] = []
    deleted_folders: list[Path] = []
    errors: list[str] = []
    parent_dirs_to_check: set[Path] = set()

    for target_path in validated_paths:
        if not target_path.exists():
            errors.append(f"Not found: {target_path.name}")
            continue

        if target_path.is_dir():
            if is_folder is False:
                errors.append(f"'{target_path.name}' is a folder, not an audio file.")
                continue
            # Ensure folder only contains audio or safe companion files before rmtree
            unsafe_found = False
            folder_audio_files: list[Path] = []
            try:
                for p in target_path.rglob("*"):
                    if p.is_symlink():
                        unsafe_found = True
                        break
                    if p.is_file():
                        ext_low = p.suffix.lower()
                        if ext_low in audio_manager.EXTENSIONS:
                            folder_audio_files.append(p)
                        elif ext_low not in SAFE_COMPANION_EXTS and not p.name.startswith("."):
                            unsafe_found = True
                            break
            except OSError as exc:
                errors.append(f"Failed to inspect folder '{target_path.name}': {exc}")
                continue

            if unsafe_found:
                errors.append(
                    f"Folder '{target_path.name}' contains other non-audio files, so it was not deleted automatically for safety."
                )
                continue

            try:
                shutil.rmtree(target_path)
                deleted_folders.append(target_path)
                deleted_files.extend(folder_audio_files)
            except OSError as exc:
                errors.append(f"Failed to delete folder '{target_path.name}': {exc}")
        else:
            if target_path.suffix.lower() not in audio_manager.EXTENSIONS:
                errors.append(f"File '{target_path.name}' is not a supported audio format.")
                continue
            parent_dir = target_path.parent
            try:
                target_path.unlink()
                deleted_files.append(target_path)
                if parent_dir != base and parent_dir.is_relative_to(base):
                    parent_dirs_to_check.add(parent_dir)
            except OSError as exc:
                errors.append(f"Failed to delete '{target_path.name}': {exc}")

    # Clean up any playlist subfolders that became completely empty after file deletion
    for pdir in sorted(parent_dirs_to_check, key=lambda p: len(p.parts), reverse=True):
        try:
            if pdir.is_dir() and not any(pdir.iterdir()):
                pdir.rmdir()
                deleted_folders.append(pdir)
        except OSError:
            pass

    if not deleted_files and not deleted_folders:
        err_detail = "; ".join(errors[:3]) if errors else "File or folder not found."
        return False, f"Delete failed: {err_detail}", [], []

    if is_folder and len(deleted_folders) == 1 and len(unique_targets) == 1:
        folder_name = deleted_folders[0].name
        msg = f"Folder '{folder_name}' ({len(deleted_files)} songs) deleted successfully."
    elif len(deleted_files) == 1 and not errors:
        msg = f"File '{deleted_files[0].name}' deleted successfully."
    else:
        msg = f"Deleted {len(deleted_files)} audio file(s)"
        if deleted_folders and not is_folder:
            msg += f" ({len(deleted_folders)} empty folder(s) also cleaned up)"
        if errors:
            msg += f" • {len(errors)} failed"
        msg += "."

    return True, msg, deleted_files, deleted_folders


JUNK_TAG_WORDS = (
    r"(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|lyrics|visualizer|mv)|"
    r"music\s*video|lyric\s*video|lyrics?|lirik(?:\s*lagu)?|video\s*klip|"
    r"visualizer|audio\s*only|full\s*album|karaoke(?:\s*version)?|"
    r"hd|hq|4k(?:\s*uhd)?|1080p|720p|mv|ost)"
)
# Unambiguous junk words that are safe to strip even without brackets (only at the end of the title).
JUNK_TRAILING_WORDS = (
    r"(?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|lyrics|visualizer|mv)|"
    r"music\s*video|lyric\s*video|lyrics?|lirik(?:\s*lagu)?|video\s*klip|"
    r"visualizer|audio\s*only|full\s*album)"
)
# Bracketed tags: any junk word. Ambiguous words (hd, mv, ost, ...) are only removed inside brackets.
JUNK_TAG_PATTERN = re.compile(
    rf"[\(\[\{{]\s*{JUNK_TAG_WORDS}\s*[\)\]\}}]",
    flags=re.IGNORECASE,
)
# Dash-separated trailing tag, e.g. "Title - Official Video". Anchored to the end so "Song - OST Remix" stays intact.
JUNK_TRAILING_PATTERN = re.compile(
    rf"(?:[｜|\-–—]+\s*){JUNK_TRAILING_WORDS}\s*$",
    flags=re.IGNORECASE,
)
YT_ID_SUFFIX_PATTERN = re.compile(r"\s*\[([A-Za-z0-9_-]{11})\]$")
# Leading track number such as "01 - ", "01. ", "01)". Not stripped when followed by another digit
# (e.g. "1-800-273-8255") and never for 4-digit numbers like "1999 - Prince".
LEADING_TRACK_NUM_PATTERN = re.compile(r"^\s*\d{1,3}\s*(?:[-._)]+|\s+-)\s*(?!\d)")


def clean_and_number_filename(
    old_name: str,
    index: int | None = None,
    pad_width: int = 2,
    numbering_mode: str = "dash",
    strip_yt_id: bool = True,
    strip_junk_tags: bool = True,
    clean_spaces: bool = True,
) -> str:
    """Computes a cleaned and optionally numbered filename while preserving extension."""
    p = Path(old_name)
    ext = p.suffix
    stem = p.stem

    # Capture trailing [11-char YouTube ID] before cleaning so we can either strip or preserve it at the end
    yt_id_match = YT_ID_SUFFIX_PATTERN.search(stem)
    yt_id_suffix = ""
    if yt_id_match:
        stem = stem[:yt_id_match.start()]
        if not strip_yt_id:
            yt_id_suffix = f" [{yt_id_match.group(1)}]"

    if strip_junk_tags:
        stem = JUNK_TAG_PATTERN.sub(" ", stem)
        stem = JUNK_TRAILING_PATTERN.sub("", stem.rstrip())

    if numbering_mode in ("dash", "dot", "strip"):
        stem = LEADING_TRACK_NUM_PATTERN.sub("", stem)

    if clean_spaces:
        # Normalize fullwidth pipes/slashes/underscores often inserted by yt-dlp
        stem = re.sub(r"[｜|]{2,}", " - ", stem)
        stem = re.sub(r"[｜|]", " - ", stem)
        stem = stem.replace("_", " ")
        stem = re.sub(r"\s*-\s*-\s*", " - ", stem)
        stem = re.sub(r"\s{2,}", " ", stem)
        stem = stem.strip(" -_|.")

    stem = stem.strip()
    if not stem:
        stem = p.stem.strip() or "Track"

    prefix = ""
    if index is not None and numbering_mode in ("dash", "dot"):
        num_str = str(index).zfill(max(2, pad_width))
        prefix = f"{num_str} - " if numbering_mode == "dash" else f"{num_str}. "

    proposed = f"{prefix}{stem}{yt_id_suffix}{ext}"
    return sanitize_entry_name(proposed)


def _natural_key(text: str) -> list:
    """Natural sort key: 'Track 2' < 'Track 10', case-insensitive."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", text)]


# Numbering modes sent by the UI (2digit_dash, ...) mapped to (internal mode, minimum zero-pad width).
_NUMBERING_ALIASES: dict[str, tuple[str, int]] = {
    "2digit_dash": ("dash", 2),
    "3digit_dash": ("dash", 3),
    "2digit_dot": ("dot", 2),
    "none": ("keep", 2),
}


def _normalize_numbering_mode(raw: object) -> tuple[str, int]:
    mode = str(raw or "dash").strip().lower()
    if mode in _NUMBERING_ALIASES:
        return _NUMBERING_ALIASES[mode]
    if mode in ("dash", "dot", "strip", "keep"):
        return mode, 2
    return "dash", 2


def batch_rename_entries(
    source_dir: Path,
    rel_paths: list[str],
    options: dict | None = None,
    preview_only: bool = False,
    expected_plan: dict[str, str] | None = None,
) -> tuple[bool, str, list[dict]]:
    """Previews or executes batch track numbering & tag cleaning per folder within source_dir.

    When expected_plan ({rel_path: new_rel_path}) is given on apply, the freshly computed plan must
    match it exactly, otherwise nothing is renamed.
    """
    base = source_dir.resolve()
    allowed_roots = get_allowed_roots()
    if not any(base.is_relative_to(r) for r in allowed_roots):
        return False, "Source directory access denied.", []

    if not isinstance(rel_paths, list) or not rel_paths:
        return False, "No audio files selected for renaming.", []

    opts = options or {}
    numbering_mode, min_pad = _normalize_numbering_mode(opts.get("numbering_mode", "dash"))
    try:
        start_number = max(0, int(opts.get("start_number", 1)))
    except (TypeError, ValueError):
        start_number = 1
    sort_by = str(opts.get("sort_by", "selection")).strip().lower()
    if sort_by not in ("selection", "name", "mtime"):
        sort_by = "selection"
    strip_yt_id = bool(opts.get("strip_yt_id", True))
    strip_junk_tags = bool(opts.get("strip_junk_tags", True))
    clean_spaces = bool(opts.get("clean_spaces", True))

    # Validate and group files by parent directory while preserving selection order
    grouped_by_parent: dict[Path, list[Path]] = {}
    seen_paths: set[Path] = set()
    for raw_rel in rel_paths:
        if not isinstance(raw_rel, str) or not raw_rel.strip():
            continue
        clean_rel = raw_rel.strip().lstrip("/\\")
        if not clean_rel or clean_rel in (".", ".."):
            continue
        target_p = (base / clean_rel).resolve()
        if not target_p.is_relative_to(base) or target_p == base:
            return False, "Path access denied (outside the source directory).", []
        if not target_p.is_file() or target_p.suffix.lower() not in audio_manager.EXTENSIONS:
            continue
        if target_p in seen_paths:
            continue
        seen_paths.add(target_p)
        grouped_by_parent.setdefault(target_p.parent, []).append(target_p)

    if not seen_paths:
        return False, "No valid audio files found.", []

    plan: list[dict] = []
    for parent_dir, folder_files in grouped_by_parent.items():
        if sort_by == "name":
            folder_files = sorted(folder_files, key=lambda p: _natural_key(p.name))
        elif sort_by == "mtime":
            def _mtime(p: Path) -> float:
                try:
                    return p.stat().st_mtime
                except OSError:
                    return 0.0
            folder_files = sorted(folder_files, key=lambda p: (_mtime(p), _natural_key(p.name)))
        max_num = start_number + len(folder_files) - 1
        pad_width = max(min_pad, 3 if max_num >= 100 else 2)
        reserved_names: set[str] = set()
        # Pre-populate existing unselected files in the same folder so we never collide with them
        try:
            for existing_f in parent_dir.iterdir():
                if existing_f.is_file() and existing_f not in seen_paths:
                    reserved_names.add(existing_f.name.lower())
        except OSError:
            pass

        for offset, old_p in enumerate(folder_files):
            seq_idx = start_number + offset
            proposed_name = clean_and_number_filename(
                old_p.name,
                index=seq_idx,
                pad_width=pad_width,
                numbering_mode=numbering_mode,
                strip_yt_id=strip_yt_id,
                strip_junk_tags=strip_junk_tags,
                clean_spaces=clean_spaces,
            )

            # Avoid duplicate target filenames within the same folder
            candidate_name = proposed_name
            if candidate_name.lower() != old_p.name.lower() and candidate_name.lower() in reserved_names:
                c_path = Path(proposed_name)
                dup_idx = 2
                while f"{c_path.stem} ({dup_idx}){c_path.suffix}".lower() in reserved_names:
                    dup_idx += 1
                candidate_name = f"{c_path.stem} ({dup_idx}){c_path.suffix}"

            reserved_names.add(candidate_name.lower())
            new_p = (parent_dir / candidate_name).resolve()
            folder_rel = str(parent_dir.relative_to(base)) if parent_dir != base else ""
            plan.append({
                "rel_path": str(old_p.relative_to(base)),
                "new_rel_path": str(new_p.relative_to(base)),
                "folder": folder_rel,
                "old_name": old_p.name,
                "new_name": candidate_name,
                "changed": old_p.name != candidate_name,
                "old_path": str(old_p),
                "new_path": str(new_p),
            })

    changed_items = [item for item in plan if item["changed"]]
    if preview_only:
        msg = f"Preview ready: {len(changed_items)} of {len(plan)} files will be renamed."
        return True, msg, plan

    # Guard against drift between what the user previewed and what would be applied now.
    if expected_plan is not None:
        current = {item["rel_path"]: item["new_rel_path"] for item in plan}
        if current != expected_plan:
            return False, "The folder contents or settings changed since the preview. Reload the preview and try again.", plan

    if not changed_items:
        return True, "All file names already match the settings (no changes).", plan

    # Two-phase rename to prevent any collision when swapping numbers (e.g. 02 -> 01 and 01 -> 02)
    staged: list[tuple[Path, Path, Path, dict]] = []
    errors: list[str] = []
    for item in changed_items:
        item["applied"] = False

    # Phase 1 is all-or-nothing: if any file cannot be staged, roll back every staged file.
    stage_failed = False
    for idx, item in enumerate(changed_items):
        old_p = Path(item["old_path"])
        new_p = Path(item["new_path"])
        tmp_p = old_p.with_name(f".swararia_ren_tmp_{os.getpid()}_{idx}{old_p.suffix}")
        try:
            old_p.rename(tmp_p)
            staged.append((old_p, tmp_p, new_p, item))
        except OSError as exc:
            errors.append(f"{old_p.name}: {exc}")
            stage_failed = True
            break

    if stage_failed:
        for old_p, tmp_p, _new_p, _item in reversed(staged):
            try:
                tmp_p.rename(old_p)
            except OSError as exc:
                errors.append(f"Rollback failed for {old_p.name} (kept as {tmp_p.name}): {exc}")
        return False, f"Rename failed, all changes were rolled back: {'; '.join(errors[:3])}", plan

    renamed_count = 0
    for old_p, tmp_p, new_p, item in staged:
        try:
            if new_p.exists():
                raise FileExistsError(f"Destination already exists: {new_p.name}")
            tmp_p.rename(new_p)
            item["applied"] = True
            renamed_count += 1
        except OSError as exc:
            errors.append(f"{old_p.name} -> {new_p.name}: {exc}")
            restore_p = old_p
            if restore_p.exists():
                restore_p = old_p.with_name(f"{old_p.stem} (restored){old_p.suffix}")
                n = 2
                while restore_p.exists():
                    restore_p = old_p.with_name(f"{old_p.stem} (restored {n}){old_p.suffix}")
                    n += 1
            try:
                tmp_p.rename(restore_p)
            except OSError as exc2:
                errors.append(f"Rollback failed for {old_p.name} (kept as {tmp_p.name}): {exc2}")

    if renamed_count == 0 and errors:
        return False, f"Failed to rename files: {'; '.join(errors[:3])}", plan

    msg = f"Cleaned up and numbered {renamed_count} audio file(s) successfully."
    if errors:
        msg += f" ({len(errors)} failed)"
    record_rename_history([
        (Path(item["old_path"]), Path(item["new_path"])) for item in changed_items if item.get("applied")
    ])
    return True, msg, plan


# ---------------------------------------------------------------------------
# Organize songs into Artist/Album folders based on embedded tags
# ---------------------------------------------------------------------------
ORGANIZE_TEMPLATES = ("artist_album", "artist")
UNKNOWN_ARTIST = "Unknown Artist"
UNKNOWN_ALBUM = "Singles"


def read_audio_tags(path: Path) -> dict[str, str]:
    """Reads lowercase tag keys (artist, album, title, ...) via ffprobe. Returns {} on failure."""
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format_tags", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=20, check=True,
        )
        raw = json.loads(proc.stdout or "{}").get("format", {}).get("tags", {}) or {}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    return {str(k).lower(): str(v).strip() for k, v in raw.items() if isinstance(v, (str, int, float))}


def _safe_folder_component(value: str, fallback: str) -> str:
    """Turns a tag value into a safe single folder name (never raises)."""
    clean = FORBIDDEN_NAME_CHARS.sub("_", value or "").strip().strip(".").strip()
    clean = re.sub(r"\s{2,}", " ", clean)[:100].strip()
    return clean or fallback


def organize_into_folders(
    source_dir: Path,
    rel_paths: list[str],
    template: str = "artist_album",
    preview_only: bool = False,
    expected_plan: dict[str, str] | None = None,
    tag_reader=None,
) -> tuple[bool, str, list[dict]]:
    """Moves audio files into Artist/Album (or Artist) folders under source_dir based on their tags.

    Files are never overwritten: a destination that already exists (or is claimed twice) is
    reported with a `reason` and skipped. Applied moves are recorded for undo.
    """
    base = source_dir.resolve()
    if not any(base.is_relative_to(r) for r in get_allowed_roots()):
        return False, "Source directory access denied.", []
    if template not in ORGANIZE_TEMPLATES:
        template = "artist_album"
    if not isinstance(rel_paths, list) or not rel_paths:
        return False, "No audio files selected.", []
    read_tags = tag_reader or read_audio_tags

    plan: list[dict] = []
    claimed: set[Path] = set()
    seen: set[Path] = set()
    for raw_rel in rel_paths:
        if not isinstance(raw_rel, str) or not raw_rel.strip():
            continue
        src = (base / raw_rel.strip().lstrip("/\\")).resolve()
        if not src.is_relative_to(base) or src == base:
            return False, "Path access denied (outside the source directory).", []
        if src in seen or not src.is_file() or src.suffix.lower() not in audio_manager.EXTENSIONS:
            continue
        seen.add(src)

        tags = read_tags(src)
        artist = _safe_folder_component(tags.get("album_artist") or tags.get("artist") or "", UNKNOWN_ARTIST)
        parts = [artist]
        if template == "artist_album":
            parts.append(_safe_folder_component(tags.get("album") or "", UNKNOWN_ALBUM))
        dest = base.joinpath(*parts, src.name).resolve()

        reason = ""
        if not dest.is_relative_to(base):
            reason = "Destination is outside the source directory"
        elif dest == src:
            reason = ""
        elif dest.exists() or dest in claimed:
            reason = "A file with the same name already exists in the destination folder"
        else:
            claimed.add(dest)
        changed = dest != src and not reason
        plan.append({
            "rel_path": str(src.relative_to(base)),
            "new_rel_path": str(dest.relative_to(base)) if dest.is_relative_to(base) else str(src.relative_to(base)),
            "folder": str(Path(*parts)),
            "old_name": src.name,
            "new_name": src.name,
            "changed": changed,
            "reason": reason,
            "old_path": str(src),
            "new_path": str(dest),
        })

    if not plan:
        return False, "No valid audio files found.", []

    # Items that cannot be moved keep their current location in the expected-plan comparison
    for item in plan:
        if item["reason"]:
            item["new_rel_path"] = item["rel_path"]

    movable = [i for i in plan if i["changed"]]
    if preview_only:
        skipped = sum(1 for i in plan if i["reason"])
        msg = f"Preview ready: {len(movable)} of {len(plan)} files will be moved into folders."
        if skipped:
            msg += f" {skipped} skipped (name conflict)."
        return True, msg, plan

    if expected_plan is not None:
        current = {i["rel_path"]: i["new_rel_path"] for i in plan}
        if current != expected_plan:
            return False, "The folder contents or tags changed since the preview. Reload the preview and try again.", plan
    if not movable:
        return True, "All files are already in the right folders (no changes).", plan

    errors: list[str] = []
    moved: list[tuple[Path, Path]] = []
    for item in movable:
        src, dest = Path(item["old_path"]), Path(item["new_path"])
        item["applied"] = False
        try:
            if dest.exists():
                raise FileExistsError(f"Destination already exists: {dest.name}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            src.rename(dest)
            item["applied"] = True
            moved.append((src, dest))
        except OSError as exc:
            errors.append(f"{src.name}: {exc}")

    record_rename_history(moved)
    if not moved:
        return False, f"Failed to move files: {'; '.join(errors[:3])}", plan
    msg = f"Moved {len(moved)} file(s) into folders based on tags."
    if errors:
        msg += f" ({len(errors)} failed)"
    return True, msg, plan


# ---------------------------------------------------------------------------
# Undo log for batch renames
# ---------------------------------------------------------------------------
RENAME_HISTORY_FILE = BASE_DIR / "library" / "rename_history.json"
RENAME_HISTORY_LIMIT = 10
_history_lock = threading.Lock()


def _load_rename_history() -> list[dict]:
    try:
        data = json.loads(RENAME_HISTORY_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save_rename_history(history: list[dict]) -> None:
    try:
        RENAME_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        RENAME_HISTORY_FILE.write_text(json.dumps(history, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def record_rename_history(moves: list[tuple[Path, Path]]) -> None:
    """Appends a batch of (old_path, new_path) moves so the batch can be undone later."""
    if not moves:
        return
    with _history_lock:
        history = _load_rename_history()
        history.append({
            "time": time.time(),
            "moves": [[str(o), str(n)] for o, n in moves],
        })
        _save_rename_history(history[-RENAME_HISTORY_LIMIT:])


def peek_rename_history() -> dict | None:
    """Returns summary of the latest undoable batch, or None."""
    with _history_lock:
        history = _load_rename_history()
    if not history:
        return None
    last = history[-1]
    return {"time": last.get("time"), "count": len(last.get("moves", []))}


def undo_last_batch_rename() -> tuple[bool, str, list[tuple[Path, Path]]]:
    """Reverts the most recent batch rename. All-or-nothing.

    Returns (ok, message, [(current_path, restored_path), ...]).
    """
    with _history_lock:
        history = _load_rename_history()
        if not history:
            return False, "No rename history available to undo.", []
        last = history[-1]
        roots = get_allowed_roots()
        pairs: list[tuple[Path, Path]] = []  # (current, restore_to)
        for old_s, new_s in last.get("moves", []):
            cur, restore = Path(new_s), Path(old_s)
            if not any(cur.resolve().is_relative_to(r) and restore.parent.resolve().is_relative_to(r) for r in roots):
                return False, "History points outside the allowed directories.", []
            if not cur.exists():
                return False, f"Cannot undo: '{cur.name}' no longer exists or was moved.", []
            if restore.exists():
                return False, f"Cannot undo: '{restore.name}' already exists again.", []
            pairs.append((cur, restore))

        staged: list[tuple[Path, Path, Path]] = []
        failed: str | None = None
        for idx, (cur, restore) in enumerate(pairs):
            tmp_p = cur.with_name(f".swararia_undo_tmp_{os.getpid()}_{idx}{cur.suffix}")
            try:
                cur.rename(tmp_p)
                staged.append((cur, tmp_p, restore))
            except OSError as exc:
                failed = f"{cur.name}: {exc}"
                break
        if failed is None:
            for i, (cur, tmp_p, restore) in enumerate(staged):
                try:
                    restore.parent.mkdir(parents=True, exist_ok=True)
                    tmp_p.rename(restore)
                except OSError as exc:
                    failed = f"{cur.name}: {exc}"
                    # put back everything not yet restored
                    staged = staged[i:]
                    break
            else:
                staged = []
        if failed is not None:
            for cur, tmp_p, _restore in reversed(staged):
                try:
                    tmp_p.rename(cur)
                except OSError:
                    pass
            return False, f"Undo failed, nothing was changed: {failed}", []

        _save_rename_history(history[:-1])
        # Remove folders left empty by undoing an "organize into folders" batch. Walk upward but never
        # remove the original folder of the file (or any of its ancestors) or an allowed root.
        for cur, restore in pairs:
            parent = cur.parent
            keep = {restore.parent, *restore.parent.parents}
            while parent not in keep and not any(parent.resolve() == r for r in roots):
                try:
                    if not parent.is_dir() or any(parent.iterdir()):
                        break
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
    return True, f"Undid the rename of {len(pairs)} file(s).", pairs


AUDIO_MIME_TYPES: dict[str, str] = {
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
}


def resolve_safe_audio_file(
    raw_source_dir: str | None,
    rel_path: str | None,
    default_inbox: Path = INBOX_DIR,
) -> tuple[Path, str]:
    """Strictly validates and resolves a local audio file within source_dir for playback streaming."""
    if not rel_path or not isinstance(rel_path, str) or not rel_path.strip():
        raise ValueError("Jalur file audio tidak boleh kosong.")

    source_dir = resolve_safe_dir(raw_source_dir, default_inbox, must_exist=True)
    clean_rel = rel_path.strip().replace("\\", "/").lstrip("/")
    if not clean_rel or clean_rel in (".", ".."):
        raise ValueError("Jalur file audio tidak valid.")

    target_path = (source_dir / clean_rel).resolve()
    if not target_path.is_relative_to(source_dir) or target_path == source_dir:
        raise ValueError("Akses jalur file ditolak (di luar batas direktori sumber).")

    rel_parts = target_path.relative_to(source_dir).parts
    if any(part in (".", "..") or part.startswith(".") or part.startswith("$") or part in SKIP_SYSTEM_DIRS for part in rel_parts):
        raise ValueError("Tidak diizinkan mengakses file sistem atau tersembunyi.")

    if target_path.is_symlink():
        raise ValueError("Tidak diizinkan memutar symbolic link.")

    if not target_path.is_file():
        raise FileNotFoundError(f"File audio tidak ditemukan: {clean_rel}")

    ext = target_path.suffix.lower()
    if ext not in audio_manager.EXTENSIONS:
        raise ValueError(f"Format file '{ext}' tidak didukung untuk pemutaran audio.")

    mime_type = AUDIO_MIME_TYPES.get(ext, "application/octet-stream")
    return target_path, mime_type




