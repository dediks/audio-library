@echo off
setlocal enabledelayedexpansion
title SWARARIA AUDIO LAB — Desktop Workstation

cd /d "%~dp0"

echo ==================================================================
echo   SWARARIA AUDIO LAB - Inisialisasi Desktop App (Windows)
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

:: 2. Verifikasi Instalasi FFmpeg & ffprobe (Cek di .vendor\bin atau Sistem PATH)
if exist ".vendor\bin\ffmpeg.exe" (
    set "PATH=%~dp0.vendor\bin;%PATH%"
)
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
    set /p "CONT=Tetap lanjutkan membuka aplikasi? (y/n): "
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

:: 4. Install / Update Dependencies (yt-dlp & pywebview)
if exist "requirements.txt" (
    echo.
    echo [2/3] Memeriksa ^& menginstall dependencies (yt-dlp ^& pywebview)...
    python -m pip install --quiet --upgrade pip
    python -m pip install --quiet -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo [PERINGATAN] Gagal memperbarui dependencies, mencoba tetap menjalankan aplikasi...
    ) else (
        echo [OK] Dependencies siap.
    )
)

:: 5. Jalankan Desktop Application
echo.
echo [3/3] Meluncurkan Jendela Desktop SWARARIA AUDIO LAB...
echo ==================================================================
echo   SWARARIA AUDIO LAB Desktop App sedang berjalan.
echo   Tutup jendela aplikasi (atau tekan Ctrl+C) untuk keluar.
echo ==================================================================

python desktop_app.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo Aplikasi berhenti dengan kode error: %ERRORLEVEL%
    pause
)
