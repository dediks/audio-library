# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller Specification for SWARARIA AUDIO LAB Desktop App."""
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

block_cipher = None
project_dir = Path(SPECPATH).resolve()

# 1. Collect static web UI assets
datas = [
    (str(project_dir / "static"), "static"),
]

binaries = []
hiddenimports = [
    "web_ui",
    "audio_manager",
    "task_engine",
    "fs_browser",
    "splitter_engine",
]

# 2. Bundle vendored yt_dlp if present in .vendor/, or collect from environment
vendor_ytdlp = project_dir / ".vendor" / "yt_dlp"
if vendor_ytdlp.is_dir():
    datas.append((str(vendor_ytdlp), "yt_dlp"))
    hiddenimports.append("yt_dlp")
else:
    try:
        tmp_ret = collect_all("yt_dlp")
        datas += tmp_ret[0]
        binaries += tmp_ret[1]
        hiddenimports += tmp_ret[2]
    except Exception:
        pass

# 3. Collect pywebview if installed
try:
    wv_ret = collect_all("webview")
    datas += wv_ret[0]
    binaries += wv_ret[1]
    hiddenimports += wv_ret[2]
except Exception:
    pass

# 4. Bundle portable ffmpeg / ffprobe binaries if present in .vendor/bin or bin/
for bin_folder in (project_dir / ".vendor" / "bin", project_dir / "bin"):
    if bin_folder.is_dir():
        for item in bin_folder.iterdir():
            if item.is_file():
                binaries.append((str(item), os.path.join(".vendor", "bin")))

a = Analysis(
    [str(project_dir / "desktop_app.py")],
    pathex=[str(project_dir), str(project_dir / ".vendor")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "test"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SwarariaAudioLab",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,  # Windowed mode (no black terminal popup on Windows/macOS)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="SwarariaAudioLab",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="SwarariaAudioLab.app",
        icon=None,
        bundle_identifier="com.swararia.audiolab",
    )

