#!/usr/bin/env python3
"""SWARARIA AUDIO LAB — Native Desktop Application Launcher.

Provides a zero-setup desktop window experience for audio engineers, FOH operators,
DJs, and general users:
1. Primary Engine: Native OS WebView window via `pywebview` (Edge WebView2 on Windows,
   WebKit on macOS, WebKitGTK/Qt on Linux).
2. Automatic Fallback: Standalone chromeless App-Mode window (`--app=...`) via
   Microsoft Edge, Google Chrome, or Chromium, or system default browser.
3. Bundled Binary Support: Works seamlessly when compiled into a standalone `.exe` / `.app`
   with PyInstaller, including embedded `yt-dlp` and portable `ffmpeg` / `ffprobe`.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

# ------------------------------------------------------------------------------
# 1. Subprocess Router for Frozen Executables (PyInstaller `SwarariaAudioLab -m yt_dlp`)
# ------------------------------------------------------------------------------
if len(sys.argv) >= 3 and sys.argv[1] == "-m" and sys.argv[2] == "yt_dlp":
    _vdir = Path(__file__).resolve().parent / ".vendor"
    if _vdir.is_dir() and str(_vdir) not in sys.path:
        sys.path.insert(0, str(_vdir))
    sys.argv = ["yt-dlp"] + sys.argv[3:]
    import yt_dlp

    yt_dlp.main()
    sys.exit(0)

# ------------------------------------------------------------------------------
# 2. Suppress Flashing Console Windows on Windows GUI Builds
# ------------------------------------------------------------------------------
if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
    _orig_popen_init = subprocess.Popen.__init__

    def _quiet_popen_init(self, *args, **kwargs):
        if "creationflags" not in kwargs or kwargs["creationflags"] == 0:
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        _orig_popen_init(self, *args, **kwargs)

    subprocess.Popen.__init__ = _quiet_popen_init  # type: ignore[method-assign]

import web_ui

WINDOW_TITLE = "SWARARIA AUDIO LAB — Pro Audio, FOH QC & DSP Workstation"
DEFAULT_WIDTH = 1360
DEFAULT_HEIGHT = 860
MIN_WIDTH = 1024
MIN_HEIGHT = 640
BG_COLOR = "#09090b"


def wait_for_server(host: str, port: int, timeout: float = 5.0) -> bool:
    """Waits until the local HTTP server is accepting connections."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def find_app_mode_browser() -> str | None:
    """Finds a Chromium-based browser capable of launching a standalone `--app` window."""
    if os.name == "nt":
        program_files = [
            os.environ.get("PROGRAMFILES", r"C:\Program Files"),
            os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
            os.environ.get("LOCALAPPDATA", ""),
        ]
        rel_candidates = [
            r"Microsoft\Edge\Application\msedge.exe",
            r"Google\Chrome\Application\chrome.exe",
            r"BraveSoftware\Brave-Browser\Application\brave.exe",
        ]
        for base in program_files:
            if not base:
                continue
            for rel in rel_candidates:
                candidate = Path(base) / rel
                if candidate.is_file():
                    return str(candidate)

    elif sys.platform == "darwin":
        mac_candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
        for c in mac_candidates:
            if os.path.isfile(c) and os.access(c, os.X_OK):
                return c

    for bin_name in (
        "google-chrome",
        "google-chrome-stable",
        "microsoft-edge",
        "microsoft-edge-stable",
        "chromium",
        "chromium-browser",
        "brave-browser",
    ):
        found = shutil.which(bin_name)
        if found:
            return found
    return None


def launch_fallback_app_window(url: str) -> subprocess.Popen | None:
    """Launches a standalone chromeless desktop window using Edge/Chrome `--app` mode."""
    browser_bin = find_app_mode_browser()
    if browser_bin:
        try:
            return subprocess.Popen(
                [
                    browser_bin,
                    f"--app={url}",
                    f"--window-size={DEFAULT_WIDTH},{DEFAULT_HEIGHT}",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            pass
    webbrowser.open(url)
    return None


def main() -> int:
    host = "127.0.0.1"
    preferred_port = 8765

    server, actual_port = web_ui.create_server(host, preferred_port)
    url = f"http://{host}:{actual_port}"

    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    wait_for_server(host, actual_port, timeout=5.0)

    print("=" * 65)
    print("  SWARARIA AUDIO LAB — DESKTOP APPLICATION MODE")
    print("=" * 65)
    print(f"  Local Workstation Engine : {url}")
    print(f"  Audio Library Inbox      : {web_ui.INBOX_DIR}")
    print("=" * 65)

    # Attempt 1: Native OS Desktop Window via pywebview
    if os.environ.get("SWARARIA_FORCE_BROWSER") != "1":
        try:
            import webview  # type: ignore[import-untyped]

            window = webview.create_window(
                title=WINDOW_TITLE,
                url=url,
                width=DEFAULT_WIDTH,
                height=DEFAULT_HEIGHT,
                min_size=(MIN_WIDTH, MIN_HEIGHT),
                background_color=BG_COLOR,
                text_select=True,
            )
            assert window is not None
            webview.start()
            server.shutdown()
            server.server_close()
            return 0
        except Exception as exc:
            sys.stderr.write(
                f"[Info] Native pywebview backend tidak tersedia ({exc}). "
                "Beralih otomatis ke Standalone App Window...\n"
            )

    # Attempt 2: Standalone Chromeless App Window (Edge / Chrome --app) or Default Browser
    launch_fallback_app_window(url)
    print("  Jendela aplikasi telah dibuka. Tekan Ctrl+C untuk keluar.")
    try:
        while server_thread.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nMenutup SWARARIA AUDIO LAB...")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

