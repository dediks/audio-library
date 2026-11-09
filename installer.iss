; ==============================================================================
; SWARARIA AUDIO LAB — Inno Setup Installer Script for Windows
; ==============================================================================
; Cara pakai di Windows:
; 1. Jalankan `python build_desktop.py` terlebih dahulu hingga folder
;    `dist\SwarariaAudioLab` terbentuk.
; 2. Buka file `installer.iss` ini menggunakan Inno Setup Compiler
;    (https://jrsoftware.org/isdl.php) lalu klik menu "Build -> Compile".
; 3. File installer tunggal `SwarariaAudioLab_Setup.exe` akan siap di folder `dist\`.
; ==============================================================================

#define MyAppName "SWARARIA AUDIO LAB"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Swararia Audio Lab"
#define MyAppExeName "SwarariaAudioLab.exe"

[Setup]
AppId={{8F4C92B1-53D2-4A9E-B8C1-72E5D649A012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\SwarariaAudioLab
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Non-admin install mode (seperti VS Code / Spotify) agar ramah pengguna awam & mudah menulis ke folder library
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist
OutputBaseFilename=SwarariaAudioLab_Setup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\SwarariaAudioLab\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\SwarariaAudioLab\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "{#MyAppExeName}"

[Dirs]
Name: "{app}\library\inbox"; Permissions: users-modify

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

