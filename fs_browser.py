#!/usr/bin/env python3
"""Filesystem Browser, Path Boundary Validation & URL Allowlist Helpers."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
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


def to_windows_path(linux_path: Path | str) -> str:
    """Converts a Linux/WSL path to a Windows-compatible path (Drive or UNC)."""
    p_str = str(linux_path).strip()
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
        return False, f"Jalur tidak ditemukan di sistem: {target_path}"

    win_path = to_windows_path(target_path)

    # 1. Search for explorer.exe or Windows launch binaries in PATH and standard locations
    explorer_candidates = [
        shutil.which("explorer.exe"),
        "/mnt/c/Windows/explorer.exe",
        "/mnt/c/WINDOWS/explorer.exe",
    ]
    explorer_bin = next((b for b in explorer_candidates if b and os.path.isfile(b) and os.access(b, os.X_OK)), None)

    if explorer_bin:
        try:
            args = [explorer_bin, win_path] if target_path.is_dir() else [explorer_bin, f"/select,{win_path}"]
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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

    return False, "Tidak dapat menemukan explorer.exe atau file manager di sistem host."


FORBIDDEN_NAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_entry_name(name: str) -> str:
    """Sanitizes a proposed filename or folder name."""
    clean = name.strip()
    if not clean:
        raise ValueError("Nama tidak boleh kosong.")
    if clean in (".", "..") or clean.startswith("."):
        raise ValueError("Nama tidak boleh diawali tanda titik (.) atau berupa nama tersembunyi.")
    if FORBIDDEN_NAME_CHARS.search(clean):
        raise ValueError('Nama mengandung karakter tidak valid (< > : " / \\ | ? * atau kontrol).')
    if len(clean) > 255:
        raise ValueError("Nama terlalu panjang (maksimum 255 karakter).")
    return clean


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
        return False, "Jalur file/folder sumber tidak valid.", Path(), Path()

    clean_new_name = sanitize_entry_name(new_name)

    base = source_dir.resolve()
    target_path = (base / rel_path.strip().lstrip("/\\")).resolve()
    if not target_path.is_relative_to(base):
        return False, "Akses jalur ditolak (di luar batas direktori sumber).", Path(), Path()
    if not target_path.exists():
        return False, f"File atau folder tidak ditemukan: {rel_path}", Path(), Path()

    target_is_dir = target_path.is_dir() if is_folder is None else bool(is_folder)
    parent_dir = target_path.parent

    if target_is_dir:
        new_path = (parent_dir / clean_new_name).resolve()
        if not new_path.is_relative_to(base):
            return False, "Akses jalur ditolak saat menentukan folder tujuan.", Path(), Path()
        if new_path == target_path:
            return True, "Nama folder tidak berubah.", target_path, new_path
        if new_path.exists():
            return False, f"Folder dengan nama '{clean_new_name}' sudah ada.", Path(), Path()
    else:
        orig_ext = target_path.suffix.lower()
        if not clean_new_name.lower().endswith(orig_ext):
            clean_new_name = f"{clean_new_name}{orig_ext}"

        new_path = (parent_dir / clean_new_name).resolve()
        if not new_path.is_relative_to(base):
            return False, "Akses jalur ditolak saat menentukan file tujuan.", Path(), Path()
        if new_path == target_path:
            return True, "Nama file tidak berubah.", target_path, new_path
        if new_path.exists():
            return False, f"File dengan nama '{clean_new_name}' sudah ada.", Path(), Path()

    try:
        target_path.rename(new_path)
        msg = f"Berhasil mengubah nama menjadi '{new_path.name}'"
        return True, msg, target_path, new_path
    except OSError as exc:
        return False, f"Gagal mengubah nama di sistem: {exc}", Path(), Path()

