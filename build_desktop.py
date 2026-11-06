#!/usr/bin/env python3
"""SWARARIA AUDIO LAB — Automated Standalone Desktop App Builder.

Packages the entire application (Python runtime, Web UI, yt-dlp, pywebview,
and local FFmpeg/ffprobe binaries) into a standalone distributable directory
(`dist/SwarariaAudioLab`) that end-users can run without installing Python or FFmpeg.

Usage:
    python build_desktop.py
    python build_desktop.py --install-deps
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENDOR_BIN_DIR = BASE_DIR / ".vendor" / "bin"
DIST_DIR = BASE_DIR / "dist" / "SwarariaAudioLab"


def stage_ffmpeg_binaries() -> list[Path]:
    """Copies system ffmpeg & ffprobe into .vendor/bin/ so PyInstaller bundles them."""
    staged: list[Path] = []
    VENDOR_BIN_DIR.mkdir(parents=True, exist_ok=True)
    exe_suffix = ".exe" if os.name == "nt" else ""

    for tool in ("ffmpeg", "ffprobe"):
        target = VENDOR_BIN_DIR / f"{tool}{exe_suffix}"
        if target.is_file():
            staged.append(target)
            continue
        sys_bin = shutil.which(tool)
        if sys_bin:
            src = Path(sys_bin).resolve()
            try:
                shutil.copy2(src, target)
                staged.append(target)
                print(f"  [OK] Membundel {tool} dari {src} -> {target}")
            except OSError as exc:
                print(f"  [WARN] Gagal menyalin {tool}: {exc}")
        else:
            print(f"  [WARN] '{tool}' tidak ditemukan di PATH. Bundle tidak akan menyertakan {tool}.")
    return staged


def ensure_build_dependencies(auto_install: bool = False) -> bool:
    """Checks if PyInstaller is installed; optionally installs pyinstaller & pywebview."""
    try:
        import PyInstaller  # noqa: F401
        return True
    except ImportError:
        if not auto_install:
            print("[INFO] PyInstaller belum terpasang di environment ini.")
            print("       Menginstall pyinstaller & pywebview secara otomatis...")
        cmd = [sys.executable, "-m", "pip", "install", "pyinstaller>=6.0", "pywebview>=5.0"]
        res = subprocess.run(cmd)
        return res.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build standalone Swararia Audio Lab desktop app.")
    parser.add_argument(
        "--install-deps",
        action="store_true",
        help="Otomatis install pyinstaller dan pywebview sebelum build.",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Bersihkan folder build/ dan dist/ sebelum memulai.",
    )
    args = parser.parse_args()

    print("=" * 68)
    print("  SWARARIA AUDIO LAB — STANDALONE DESKTOP APP BUILDER")
    print("=" * 68)

    if args.clean:
        for d in (BASE_DIR / "build", BASE_DIR / "dist"):
            if d.is_dir():
                print(f"  Membersihkan {d}...")
                shutil.rmtree(d, ignore_errors=True)

    print("\n[1/4] Menyiapkan binary FFmpeg & ffprobe portable...")
    stage_ffmpeg_binaries()

    print("\n[2/4] Memeriksa PyInstaller & dependensi build...")
    if not ensure_build_dependencies(auto_install=args.install_deps):
        print("[ERROR] Gagal menyiapkan PyInstaller. Jalankan: pip install pyinstaller pywebview")
        return 1

    print("\n[3/4] Menjalankan PyInstaller (SwarariaAudioLab.spec)...")
    spec_file = BASE_DIR / "SwarariaAudioLab.spec"
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", str(spec_file)]
    res = subprocess.run(cmd, cwd=str(BASE_DIR))
    if res.returncode != 0:
        print(f"[ERROR] Proses build PyInstaller gagal (exit code {res.returncode}).")
        return res.returncode

    print("\n[4/4] Menyiapkan struktur folder library/inbox di paket distribusi...")
    if DIST_DIR.is_dir():
        inbox = DIST_DIR / "library" / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        gitkeep = inbox / ".gitkeep"
        if not gitkeep.exists():
            gitkeep.write_text("", encoding="utf-8")

    exe_name = "SwarariaAudioLab.exe" if os.name == "nt" else "SwarariaAudioLab"
    exe_path = DIST_DIR / exe_name

    print("\n" + "=" * 68)
    print("  ✅ BUILD DESKTOP APP SELESAI!")
    print("=" * 68)
    print(f"  Folder Distribusi : {DIST_DIR}")
    print(f"  File Executable   : {exe_path}")
    print("\n  Cara membagikan ke orang awam:")
    print("  1. Kompres folder 'dist/SwarariaAudioLab' menjadi file .zip (Portable)")
    print("     ATAU")
    print("  2. Buka 'installer.iss' menggunakan Inno Setup di Windows untuk")
    print("     membuat 1 file installer 'SwarariaAudioLab_Setup.exe'.")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())

