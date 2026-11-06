@echo off
setlocal enabledelayedexpansion
title SWARARIA AUDIO LAB Workstation

cd /d "%~dp0"

echo ==================================================================
echo   SWARARIA AUDIO LAB - Inisialisasi Sistem (Windows)
echo ==================================================================

:: 1. Verifikasi Instalasi Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    where py >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Python tidak ditemukan di sistem Anda!
        echo Silakan unduh dan install Python 3.10+ dari:
        echo   https://www.python.org/downloads/
        echo PENTING: Saat instalasi, centang kotak "Add Python to PATH".
        echo ==================================================================
        pause
        exit /b 1
    ) else (
        set "PY_CMD=py"
    )
) else (
    set "PY_CMD=python"
)

for /f "tokens=*" %%v in ('%PY_CMD% --version 2^>^&1') do echo [OK] %%v terdeteksi.

:: 2. Verifikasi Instalasi FFmpeg & ffprobe
where ffmpeg >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo.
    echo [PERINGATAN] FFmpeg belum terpasang atau belum masuk PATH!
    echo Fitur QC EBU R128, Konverter SoXR, dan Ingest membutuhkan FFmpeg.
    echo.
    echo Cara termudah install di Windows (PowerShell/CMD):
    echo   winget install Gyan.FFmpeg
    echo Atau download manual dari: https://www.gyan.dev/ffmpeg/builds/
    echo ------------------------------------------------------------------
    set /p "CONT=Tetap lanjutkan membuka server? (y/n): "
    if /i "!CONT!" neq "y" (
        echo Dibatalkan oleh pengguna. Silakan pasang FFmpeg terlebih dahulu.
        pause
        exit /b 1
    )
) else (
    echo [OK] FFmpeg dan ffprobe siap.
)

:: 3. Setup / Aktivasi Virtual Environment (.venv)
if not exist ".venv" (
    echo.
    echo [1/3] Membuat virtual environment Python (.venv)...
    %PY_CMD% -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Gagal membuat virtual environment (.venv).
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat

:: 4. Install / Update Dependencies
if exist "requirements.txt" (
    echo.
    echo [2/3] Memeriksa & menginstall dependencies (yt-dlp)...
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo [PERINGATAN] Gagal memperbarui dependencies, mencoba tetap menjalankan server...
    ) else (
        echo [OK] Dependencies siap.
    )
)

:: 5. Jalankan Web UI & Buka Browser
echo.
echo [3/3] Membuka browser ke http://127.0.0.1:8765 ...
start "" http://127.0.0.1:8765

echo ==================================================================
echo   SWARARIA AUDIO LAB berjalan di http://127.0.0.1:8765
echo   Tekan Ctrl+C di jendela ini untuk mematikan server.
echo ==================================================================

python web_ui.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo Server terhenti dengan kode error: %ERRORLEVEL%
    pause
)

