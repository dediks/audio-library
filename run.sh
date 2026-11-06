#!/usr/bin/env bash
# ==============================================================================
# SWARARIA AUDIO LAB — Unified Runner Script for Linux & macOS
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================================="
echo "  SWARARIA AUDIO LAB — Initializing Environment"
echo "=================================================================="

# 1. Check Python installation
PYTHON_BIN=""
if command -v python3 &>/dev/null; then
    PYTHON_BIN="python3"
elif command -v python &>/dev/null; then
    PYTHON_BIN="python"
else
    echo "❌ Error: Python tidak ditemukan di sistem Anda."
    echo "   Silakan install Python 3.10+ terlebih dahulu:"
    echo "   - Ubuntu/Debian: sudo apt update && sudo apt install -y python3 python3-pip python3-venv"
    echo "   - macOS: brew install python"
    exit 1
fi

PY_VER=$($PYTHON_BIN -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✓ Python terdeteksi: $PYTHON_BIN (v$PY_VER)"

# 2. Check FFmpeg & FFprobe
MISSING_FFMPEG=0
if ! command -v ffmpeg &>/dev/null; then
    MISSING_FFMPEG=1
fi
if ! command -v ffprobe &>/dev/null; then
    MISSING_FFMPEG=1
fi

if [ $MISSING_FFMPEG -eq 1 ]; then
    echo "⚠️  PERINGATAN: FFmpeg dan/atau ffprobe belum terpasang di sistem!"
    echo "   Fitur QC EBU R128, SoXR 28-bit Converter, dan Ingest membutuhkan FFmpeg."
    echo "   Cara install cepat:"
    echo "   - Ubuntu/Debian: sudo apt update && sudo apt install -y ffmpeg"
    echo "   - Arch Linux:    sudo pacman -S ffmpeg"
    echo "   - macOS:         brew install ffmpeg"
    echo "------------------------------------------------------------------"
    read -r -p "Tetap lanjutkan tanpa FFmpeg? (y/N): " CONTINUE_WITHOUT_FFMPEG
    if [[ ! "$CONTINUE_WITHOUT_FFMPEG" =~ ^[yY]$ ]]; then
        echo "Instalasi dibatalkan. Silakan pasang FFmpeg terlebih dahulu."
        exit 1
    fi
else
    echo "✓ FFmpeg & ffprobe siap."
fi

# 3. Setup / Activate Virtual Environment (.venv)
VENV_DIR="$SCRIPT_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Membuat virtual environment Python (.venv)..."
    if ! $PYTHON_BIN -m venv "$VENV_DIR"; then
        echo "❌ Gagal membuat virtual environment."
        echo "   Pada Ubuntu/Debian, Anda mungkin perlu menginstall modul venv:"
        echo "   sudo apt install -y python3-venv"
        exit 1
    fi
fi

# Activate virtual environment
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# 4. Install / Update dependencies
if [ -f "requirements.txt" ]; then
    echo "📦 Memeriksa & menginstall dependencies dari requirements.txt..."
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt
    echo "✓ Dependencies siap (yt-dlp)."
fi

# 5. Open browser automatically in background (if desktop GUI is active)
if [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || [[ "$OSTYPE" == "darwin"* ]]; then
    (
        sleep 1.5
        if command -v xdg-open &>/dev/null; then
            xdg-open "http://127.0.0.1:8765" &>/dev/null || true
        elif command -v open &>/dev/null; then
            open "http://127.0.0.1:8765" &>/dev/null || true
        fi
    ) &
fi

echo "=================================================================="
echo "  🚀 Menjalankan SWARARIA AUDIO LAB di http://127.0.0.1:8765"
echo "  Tekan Ctrl+C untuk menghentikan server."
echo "=================================================================="

# 6. Start Web UI
exec python web_ui.py

