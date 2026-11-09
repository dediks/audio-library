@echo off
setlocal enabledelayedexpansion
title SWARARIA AUDIO LAB — Windows Wizard Installer Builder

cd /d "%~dp0"

echo ==================================================================
echo   SWARARIA AUDIO LAB - Windows Wizard Installer Builder
echo ==================================================================
echo.

:: 1. Verifikasi Python
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

:: 2. Verifikasi Inno Setup Compiler (ISCC.exe)
set "ISCC_PATH="
where iscc >nul 2>nul
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('where iscc') do set "ISCC_PATH=%%i"
) else (
    if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
        set "ISCC_PATH=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
    ) else if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
        set "ISCC_PATH=%ProgramFiles%\Inno Setup 6\ISCC.exe"
    ) else if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" (
        set "ISCC_PATH=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
    )
)

if "!ISCC_PATH!"=="" (
    echo [INFO] Inno Setup 6 belum terdeteksi di komputer Anda.
    echo Inno Setup dibutuhkan untuk mengemas aplikasi menjadi Setup Wizard (.exe).
    echo.
    set /p "DO_INSTALL=Install Inno Setup 6 otomatis sekarang via winget? (y/n): "
    if /i "!DO_INSTALL!"=="y" (
        echo Menjalankan: winget install JRSoftware.InnoSetup...
        winget install JRSoftware.InnoSetup --accept-source-agreements --accept-package-agreements
        if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
            set "ISCC_PATH=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
        ) else if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" (
            set "ISCC_PATH=%ProgramFiles%\Inno Setup 6\ISCC.exe"
        )
    )
)

:: 3. Jalankan build_desktop.py dengan flag --install-deps dan --installer
echo.
echo Menjalankan proses build aplikasi desktop dan installer wizard...
%PY_CMD% build_desktop.py --install-deps --installer

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Proses pembuatan installer mengalami kendala (exit code %ERRORLEVEL%).
    pause
    exit /b %ERRORLEVEL%
)

:: 4. Buka folder dist jika sukses
if exist "dist\SwarariaAudioLab_Setup.exe" (
    echo.
    echo [SUKSES] File installer wizard siap:
    echo   dist\SwarariaAudioLab_Setup.exe
    echo.
    echo Membuka folder dist di Windows Explorer...
    explorer /select,"%~dp0dist\SwarariaAudioLab_Setup.exe"
)

echo.
pause

