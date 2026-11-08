#!/usr/bin/env python3
"""Audio Library Web UI: Localhost Server for Batch Ingestion & QC Monitoring.

Designed for audio engineers and programmers.
Listens strictly on 127.0.0.1 for maximum local security.
"""
from __future__ import annotations

import base64
import hmac
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import audio_manager
import fs_browser
import splitter_engine
from task_engine import AudioMetadataCache, TaskQueueManager

BASE_DIR = fs_browser.BASE_DIR
RESOURCE_DIR = fs_browser.RESOURCE_DIR
STATIC_DIR = RESOURCE_DIR / "static"
INBOX_DIR = fs_browser.INBOX_DIR
ARCHIVE_FILE = BASE_DIR / "library" / "downloaded_ids.txt"
COOKIES_FILE = BASE_DIR / "library" / "cookies.txt"

# Instantiate shared state managers
metadata_cache = AudioMetadataCache()
task_manager = TaskQueueManager(
    metadata_cache=metadata_cache,
    inbox_dir=INBOX_DIR,
    archive_file=ARCHIVE_FILE,
    cookies_file=COOKIES_FILE,
)

# Backward-compatible module-level aliases
SKIP_SYSTEM_DIRS = fs_browser.SKIP_SYSTEM_DIRS
get_allowed_roots = fs_browser.get_allowed_roots
normalize_windows_or_wsl_path = fs_browser.normalize_windows_or_wsl_path
resolve_safe_dir = fs_browser.resolve_safe_dir
iter_audio_files_safe = fs_browser.iter_audio_files_safe
get_windows_shortcuts = fs_browser.get_windows_shortcuts
validate_url = fs_browser.validate_url

queue_lock = task_manager.lock
cache_lock = metadata_cache.lock
task_queue = task_manager.queue
task_history = task_manager.history
cached_qc_results = metadata_cache.qc_results
cached_meta_results = metadata_cache.meta_results
probe_files_fast = metadata_cache.probe_files_fast
run_worker = task_manager.run_worker_loop


def check_system_binaries() -> dict:
    """Verifies available system binaries required for audio operations."""
    return {
        "python": sys.version.split()[0],
        "yt_dlp": audio_manager.is_ytdlp_available(),
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "cookies_present": COOKIES_FILE.is_file(),
    }


_cached_lan_ips: list[str] = []
_cached_interfaces: list[dict] = []
_cached_lan_ips_ts: float = 0.0
_lan_ips_lock = threading.Lock()
_is_wsl_cached: bool | None = None


def is_wsl_environment() -> bool:
    """Returns True if running inside Windows Subsystem for Linux (WSL/WSL2)."""
    global _is_wsl_cached
    if _is_wsl_cached is not None:
        return _is_wsl_cached
    if os.name == "nt":
        _is_wsl_cached = False
        return False
    try:
        proc_ver = Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower()
        if "microsoft" in proc_ver or "wsl" in proc_ver:
            _is_wsl_cached = True
            return True
    except Exception:
        pass
    _is_wsl_cached = bool(os.environ.get("WSL_DISTRO_NAME"))
    return _is_wsl_cached


def _is_valid_lan_ipv4(candidate: str) -> bool:
    c = candidate.strip()
    if not c or ":" in c:
        return False
    if c.startswith("127.") or c.startswith("169.254.") or c == "0.0.0.0":
        return False
    parts = c.split(".")
    return len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)


def _find_windows_sys32_bin(exe_name: str) -> str | None:
    """Locates a Windows System32 executable from WSL or native Windows."""
    found = shutil.which(exe_name)
    if found:
        return found
    for prefix in ("/mnt/c/Windows/System32", "/mnt/c/WINDOWS/system32", "/mnt/c/Windows/Sysnative"):
        cand = f"{prefix}/{exe_name}"
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _parse_windows_ipconfig() -> list[dict]:
    """Runs ipconfig.exe (from Windows or WSL2) and extracts real Wi-Fi / LAN adapters."""
    ipconfig_bin = _find_windows_sys32_bin("ipconfig.exe")
    if not ipconfig_bin:
        return []
    try:
        raw = subprocess.check_output(
            [ipconfig_bin],
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.0,
        )
    except Exception:
        return []

    adapters: list[dict] = []
    curr_name = "Windows Network"
    curr_ips: list[str] = []
    curr_gw = ""

    def _flush_adapter() -> None:
        nonlocal curr_ips, curr_gw
        if not curr_ips:
            return
        low = curr_name.lower()
        is_virtual = any(
            k in low
            for k in ("wsl", "hyper-v", "vethernet", "docker", "vmware", "virtualbox", "loopback", "bluetooth")
        )
        is_wifi = any(
            k in low
            for k in ("wi-fi", "wireless", "wlan", "local area connection*", "hotspot")
        )
        short_name = re.sub(
            r"^(Wireless LAN adapter|Ethernet adapter)\s+",
            "",
            curr_name,
            flags=re.IGNORECASE,
        ).strip() or curr_name
        for ip in curr_ips:
            if not _is_valid_lan_ipv4(ip):
                continue
            if is_virtual:
                kind = "virtual"
                label = f"Virtual Adapter ({short_name})"
                reachable = False
                priority = 90
            elif is_wifi:
                kind = "wifi"
                label = f"Wi-Fi / Hotspot Laptop ({short_name})"
                reachable = True
                priority = 1 if curr_gw else 2
            else:
                kind = "lan"
                label = f"LAN Ethernet Laptop ({short_name})"
                reachable = True
                priority = 3 if curr_gw else 4
            adapters.append({
                "ip": ip,
                "adapter": curr_name,
                "label": label,
                "kind": kind,
                "has_gateway": bool(curr_gw),
                "reachable_from_hp": reachable,
                "priority": priority,
            })
        curr_ips = []
        curr_gw = ""

    for raw_line in raw.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        if not line[0].isspace() and line.endswith(":"):
            _flush_adapter()
            curr_name = line[:-1].strip()
            continue
        ip_match = re.search(r"IPv4[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})", line, re.IGNORECASE)
        if ip_match:
            curr_ips.append(ip_match.group(1))
            continue
        gw_match = re.search(r"Default Gateway[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})", line, re.IGNORECASE)
        if gw_match:
            curr_gw = gw_match.group(1)

    _flush_adapter()
    adapters.sort(key=lambda item: item["priority"])
    return adapters


def _get_linux_internal_ips() -> list[str]:
    ips: list[str] = []

    def _add(c: str) -> None:
        c = c.strip()
        if _is_valid_lan_ipv4(c) and c not in ips:
            ips.append(c)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0.2)
            s.connect(("10.255.255.255", 1))
            _add(s.getsockname()[0])
    except Exception:
        pass

    try:
        _, _, host_ips = socket.gethostbyname_ex(socket.gethostname())
        for ip in host_ips:
            _add(ip)
    except Exception:
        pass

    if sys.platform.startswith("linux"):
        try:
            out = subprocess.check_output(["hostname", "-I"], text=True, timeout=1.0)
            for token in out.split():
                _add(token)
        except Exception:
            pass
    return ips


def get_network_interfaces_detail(force_refresh: bool = False) -> list[dict]:
    """Returns detailed network interface list prioritizing real Wi-Fi/Hotspot IPs over WSL2 virtual IPs."""
    global _cached_lan_ips, _cached_interfaces, _cached_lan_ips_ts
    now = time.time()
    with _lan_ips_lock:
        if not force_refresh and _cached_interfaces and (now - _cached_lan_ips_ts) < 10.0:
            return list(_cached_interfaces)

    is_wsl = is_wsl_environment()
    interfaces: list[dict] = []
    seen_ips: set[str] = set()

    if is_wsl or os.name == "nt":
        for item in _parse_windows_ipconfig():
            ip = item["ip"]
            if ip not in seen_ips:
                seen_ips.add(ip)
                interfaces.append(item)

    linux_ips = _get_linux_internal_ips()
    for ip in linux_ips:
        if ip in seen_ips:
            continue
        seen_ips.add(ip)
        if is_wsl:
            interfaces.append({
                "ip": ip,
                "adapter": "WSL2 eth0",
                "label": "WSL2 Virtual IP (Internal Linux di dalam Laptop — Bukan IP Wi-Fi)",
                "kind": "wsl_internal",
                "has_gateway": True,
                "reachable_from_hp": False,
                "priority": 95,
            })
        else:
            interfaces.append({
                "ip": ip,
                "adapter": "Local Network",
                "label": "Wi-Fi / LAN Laptop",
                "kind": "wifi",
                "has_gateway": True,
                "reachable_from_hp": True,
                "priority": 1,
            })

    interfaces.sort(key=lambda x: x["priority"])
    # Prefer reachable Wi-Fi/LAN IPs for the main list; fall back to all only if none found
    reachable_ifaces = [x for x in interfaces if x["reachable_from_hp"]]
    visible_interfaces = reachable_ifaces if reachable_ifaces else interfaces
    primary_ips = [x["ip"] for x in visible_interfaces]

    with _lan_ips_lock:
        _cached_interfaces = list(visible_interfaces)
        _cached_lan_ips = list(primary_ips)
        _cached_lan_ips_ts = now
    return list(visible_interfaces)


def get_local_lan_ips(force_refresh: bool = False) -> list[str]:
    """Detects local Wi-Fi / LAN IPv4 addresses for FOH Mobile Remote connectivity."""
    get_network_interfaces_detail(force_refresh=force_refresh)
    with _lan_ips_lock:
        return list(_cached_lan_ips)


def _verify_windows_http_reachable(ip: str, port: int) -> bool:
    """Tests from the Windows host side (via curl.exe) whether http://ip:port/api/system returns HTTP 200."""
    if not ip:
        return False
    curl_bin = _find_windows_sys32_bin("curl.exe")
    if not curl_bin:
        return False
    try:
        out = subprocess.check_output(
            [
                curl_bin,
                "-s",
                "-o",
                "NUL",
                "-w",
                "%{http_code}",
                "--max-time",
                "1.5",
                f"http://{ip}:{port}/api/system",
            ],
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.5,
        ).strip()
        return out == "200"
    except Exception:
        return False


def _get_wsl_remote_bridge_port(server_port: int) -> int:
    """Uses server_port + 1 (8766) on Windows host for WSL2 portproxy so port 8765 (wslrelay) is never hijacked."""
    return (server_port + 1) if is_wsl_environment() else server_port


def _cleanup_stale_wsl_listen_port(port: int) -> None:
    """If an old netsh portproxy rule is listening on `port` (8765), removes it before server bind so wslrelay works."""
    if not is_wsl_environment():
        return
    netsh_bin = _find_windows_sys32_bin("netsh.exe")
    ps_bin = _find_windows_sys32_bin("powershell.exe")
    if not netsh_bin or not ps_bin:
        return
    stale_listen_ips: list[str] = []
    try:
        out = subprocess.check_output(
            [netsh_bin, "interface", "portproxy", "show", "v4tov4"],
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.0,
        )
        for line in out.splitlines():
            m = re.match(
                r"^\s*(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)",
                line,
            )
            if m and int(m.group(2)) == port:
                stale_listen_ips.append(m.group(1))
    except Exception:
        return

    if not stale_listen_ips:
        return

    print("=" * 65)
    print(f"  [WSL2 Auto-Heal] Membersihkan aturan portproxy lama di port {port}")
    print("  Silakan klik 'Yes' pada jendela konfirmasi Windows yang muncul...")
    print("=" * 65)
    del_cmds = [
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={lip} | Out-Null;"
        for lip in stale_listen_ips
    ]
    inner_script = " ".join(del_cmds)
    inner_b64 = base64.b64encode(inner_script.encode("utf-16le")).decode("ascii")
    outer_cmd = (
        f"Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden "
        f"-Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{inner_b64}'"
    )
    outer_b64 = base64.b64encode(outer_cmd.encode("utf-16le")).decode("ascii")
    try:
        subprocess.run(
            [ps_bin, "-NoProfile", "-NonInteractive", "-EncodedCommand", outer_b64],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=30.0,
            check=False,
        )
    except Exception:
        pass


def get_wsl_bridge_status(port: int) -> dict:
    """Checks if Windows portproxy is forwarding Wi-Fi IP:8766 -> 127.0.0.1:8765 (wslrelay) into WSL2."""
    if not is_wsl_environment():
        return {"is_wsl": False, "bridge_active": True, "bridge_port": port}

    bridge_port = _get_wsl_remote_bridge_port(port)
    wsl_ips = _get_linux_internal_ips()
    wsl_ip = wsl_ips[0] if wsl_ips else ""
    lan_ips = get_local_lan_ips(force_refresh=False)
    wifi_ip = lan_ips[0] if lan_ips else ""

    netsh_bin = _find_windows_sys32_bin("netsh.exe")
    has_rule = False
    if netsh_bin:
        try:
            out = subprocess.check_output(
                [netsh_bin, "interface", "portproxy", "show", "v4tov4"],
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=2.0,
            )
            for line in out.splitlines():
                m = re.match(
                    r"^\s*(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)",
                    line,
                )
                if m and int(m.group(2)) == bridge_port and int(m.group(4)) == port:
                    has_rule = True
                    break
        except Exception:
            pass

    if wifi_ip and _find_windows_sys32_bin("curl.exe"):
        bridge_active = has_rule and _verify_windows_http_reachable(wifi_ip, bridge_port)
    else:
        bridge_active = has_rule

    listen_addr = wifi_ip if wifi_ip else "0.0.0.0"
    ps_cmd = (
        f"Start-Service iphlpsvc -ErrorAction SilentlyContinue; "
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress=0.0.0.0; "
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={listen_addr}; "
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0; "
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress={listen_addr}; "
        f"netsh interface portproxy add v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 connectport={port} connectaddress=127.0.0.1; "
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {bridge_port}\"; "
        f"netsh advfirewall firewall add rule name=\"Swararia FOH Remote {bridge_port}\" dir=in action=allow protocol=TCP localport={bridge_port} profile=any"
    )
    return {
        "is_wsl": True,
        "wsl_ip": wsl_ip,
        "wifi_ip": wifi_ip,
        "bridge_port": bridge_port,
        "bridge_active": bridge_active,
        "powershell_admin_cmd": ps_cmd,
    }


def enable_wsl_port_bridge(port: int) -> tuple[bool, str, dict]:
    """Launches an elevated Windows PowerShell UAC prompt to bridge Windows Wi-Fi port 8766 -> 127.0.0.1:8765 (wslrelay)."""
    status = get_wsl_bridge_status(port)
    if not status.get("is_wsl"):
        return True, "Bukan lingkungan WSL2 (tidak memerlukan bridge).", status
    bridge_port = _get_wsl_remote_bridge_port(port)
    wsl_ip = status.get("wsl_ip") or ""

    lan_ips = get_local_lan_ips(force_refresh=True)
    wifi_ip = lan_ips[0] if lan_ips else ""
    listen_addr = wifi_ip if wifi_ip else "0.0.0.0"

    ps_bin = _find_windows_sys32_bin("powershell.exe")
    if not ps_bin:
        return False, "powershell.exe tidak ditemukan dari WSL2.", status

    inner_lines = [
        "Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue;",
        "Start-Service iphlpsvc -ErrorAction SilentlyContinue;",
        # Always remove any old rules on `port` (8765) so wslrelay on 127.0.0.1:8765 is never blocked
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={listen_addr} | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress={listen_addr} | Out-Null;",
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {port}\" | Out-Null;",
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {bridge_port}\" | Out-Null;",
        f"netsh advfirewall firewall add rule name=\"Swararia FOH Remote {bridge_port}\" dir=in action=allow protocol=TCP localport={bridge_port} profile=any | Out-Null;",
        # Primary path: 0.0.0.0:8766 -> 127.0.0.1:8765 (uses wslrelay AF_VSOCK, immune to Hyper-V firewall & server restarts)
        f"netsh interface portproxy add v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 connectport={port} connectaddress=127.0.0.1 | Out-Null;",
    ]
    if wifi_ip and wsl_ip:
        inner_lines.extend([
            f"$code = (& curl.exe -s -o NUL -w '%{{http_code}}' --max-time 2 'http://{wifi_ip}:{bridge_port}/api/system');",
            "if ($code -ne '200') {",
            f"  try {{ New-NetFirewallHyperVRule -Name 'SwarariaFOH{port}' -DisplayName 'Swararia FOH Remote {port}' -Direction Inbound -VMCreatorId '{{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}}' -Protocol TCP -LocalPorts {port} -Action Allow -ErrorAction SilentlyContinue | Out-Null; }} catch {{}}",
            f"  netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 | Out-Null;",
            f"  netsh interface portproxy add v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 connectport={port} connectaddress={wsl_ip} | Out-Null;",
            "}",
        ])

    inner_script = " ".join(inner_lines)
    inner_b64 = base64.b64encode(inner_script.encode("utf-16le")).decode("ascii")
    outer_cmd = (
        f"Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden "
        f"-Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{inner_b64}'"
    )
    outer_b64 = base64.b64encode(outer_cmd.encode("utf-16le")).decode("ascii")
    try:
        subprocess.run(
            [ps_bin, "-NoProfile", "-NonInteractive", "-EncodedCommand", outer_b64],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=35.0,
            check=False,
        )
    except Exception as exc:
        return False, f"Gagal menjalankan PowerShell UAC: {exc}", get_wsl_bridge_status(port)

    updated = get_wsl_bridge_status(port)
    if updated.get("bridge_active"):
        return (
            True,
            f"Jembatan Port {bridge_port} ({listen_addr}:{bridge_port} -> WSL2:{port}) berhasil diaktifkan & terverifikasi!",
            updated,
        )
    return (
        False,
        "Jembatan belum merespons HTTP 200 (Pastikan Anda klik 'Yes' pada jendela konfirmasi Admin Windows).",
        updated,
    )


def disable_wsl_port_bridge(port: int) -> tuple[bool, str, dict]:
    """Removes the Windows portproxy rule and firewall rules for the specified port."""
    status = get_wsl_bridge_status(port)
    if not status.get("is_wsl"):
        return True, "Bukan lingkungan WSL2.", status

    bridge_port = _get_wsl_remote_bridge_port(port)
    lan_ips = get_local_lan_ips(force_refresh=True)
    wifi_ip = lan_ips[0] if lan_ips else ""
    ps_bin = _find_windows_sys32_bin("powershell.exe")
    if not ps_bin:
        return False, "powershell.exe tidak ditemukan.", status

    inner_lines = [
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {port}\" | Out-Null;",
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {bridge_port}\" | Out-Null;",
        "try {",
        f"  Remove-NetFirewallHyperVRule -Name 'SwarariaFOH{port}' -ErrorAction SilentlyContinue;",
        "  Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Block -ErrorAction SilentlyContinue | Out-Null;",
        "} catch {}",
    ]
    if wifi_ip:
        inner_lines.insert(
            1,
            f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={wifi_ip} | Out-Null;",
        )
        inner_lines.insert(
            2,
            f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress={wifi_ip} | Out-Null;",
        )

    inner_script = " ".join(inner_lines)
    inner_b64 = base64.b64encode(inner_script.encode("utf-16le")).decode("ascii")
    outer_cmd = (
        f"Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden "
        f"-Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{inner_b64}'"
    )
    outer_b64 = base64.b64encode(outer_cmd.encode("utf-16le")).decode("ascii")
    try:
        subprocess.run(
            [ps_bin, "-NoProfile", "-NonInteractive", "-EncodedCommand", outer_b64],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=30.0,
            check=False,
        )
    except Exception as exc:
        return False, f"Gagal menutup jembatan port: {exc}", get_wsl_bridge_status(port)

    updated = get_wsl_bridge_status(port)
    return True, f"Jembatan Port {bridge_port} & aturan Firewall telah dihapus kembali (Tertutup Rapat).", updated


ALLOWED_REMOTE_ACTIONS = {
    "play_pause",
    "play",
    "pause",
    "stop",
    "prev",
    "next",
    "fade",
    "seek_ratio",
    "nudge",
    "cue_zero",
    "set_play_mode",
    "set_volume",
    "toggle_mute",
    "set_preamp",
    "set_eq",
    "reset_eq",
    "set_routing",
    "set_autotrim",
    "reset_peak",
    "trigger_pad",
    "restart_pad",
    "clear_pad",
    "assign_pad",
    "load_track",
    "select_playlist",
}


class RemotePlayerHub:
    """Thread-safe synchronization hub between Master FOH Deck (Laptop/PC) and HP Wireless Remotes."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.enabled: bool = True
        self.pin: str = f"{secrets.randbelow(9000) + 1000:04d}"
        self.master_state: dict = {
            "track": None,
            "is_playing": False,
            "transport_state": "STOPPED",
            "current_time": 0.0,
            "duration": 0.0,
            "play_mode": "single_stop",
            "volume": 100,
            "is_muted": False,
            "preamp_db": 0.0,
            "eq_low_db": 0.0,
            "eq_mid_db": 0.0,
            "eq_high_db": 0.0,
            "routing_mode": "stereo",
            "auto_trim": False,
            "peak_db": -100.0,
            "rta_bands": [],
            "vu_l": 0.0,
            "vu_r": 0.0,
            "cue_pads": [None] * 8,
            "source_dir": "",
            "active_playlist": "__ALL__",
        }
        self.master_updated_at: float = 0.0
        self.command_queue: list[dict] = []
        self.next_cmd_id: int = 1
        self.remote_clients: dict[str, float] = {}

    def _prune_clients_unlocked(self, now: float) -> None:
        stale = [cid for cid, ts in self.remote_clients.items() if (now - ts) > 10.0]
        for cid in stale:
            self.remote_clients.pop(cid, None)

    def verify_pin(self, candidate: str | None) -> bool:
        clean = str(candidate or "").strip()
        if not clean:
            return False
        with self.lock:
            return hmac.compare_digest(clean, self.pin)

    def regenerate_pin(self) -> str:
        with self.lock:
            self.pin = f"{secrets.randbelow(9000) + 1000:04d}"
            self.remote_clients.clear()
            return self.pin

    def set_enabled(self, flag: bool) -> bool:
        with self.lock:
            self.enabled = bool(flag)
            if not self.enabled:
                self.command_queue.clear()
                self.remote_clients.clear()
            return self.enabled

    def get_active_remotes_count(self) -> int:
        now = time.time()
        with self.lock:
            self._prune_clients_unlocked(now)
            return len(self.remote_clients)

    def update_master_state(self, state_payload: dict | None) -> tuple[list[dict], int, str, bool]:
        now = time.time()
        with self.lock:
            if isinstance(state_payload, dict) and state_payload:
                self.master_state = state_payload
                self.master_updated_at = now
            self._prune_clients_unlocked(now)
            pending = list(self.command_queue)
            self.command_queue.clear()
            return pending, len(self.remote_clients), self.pin, self.enabled

    def get_remote_state(self, client_id: str) -> dict:
        now = time.time()
        with self.lock:
            self.remote_clients[client_id] = now
            self._prune_clients_unlocked(now)
            return {
                "ok": True,
                "enabled": self.enabled,
                "master_online": (now - self.master_updated_at) < 5.0,
                "master_updated_at": self.master_updated_at,
                "active_remotes_count": len(self.remote_clients),
                "state": self.master_state,
            }

    def enqueue_command(self, action: str, params: dict | None, client_id: str) -> dict:
        now = time.time()
        with self.lock:
            self.remote_clients[client_id] = now
            self._prune_clients_unlocked(now)
            cmd = {
                "id": self.next_cmd_id,
                "action": action,
                "params": params if isinstance(params, dict) else {},
                "created_at": now,
            }
            self.next_cmd_id += 1
            self.command_queue.append(cmd)
            if len(self.command_queue) > 50:
                self.command_queue = self.command_queue[-50:]
            return cmd


remote_hub = RemotePlayerHub()


class AudioServerHandler(BaseHTTPRequestHandler):
    """Secure HTTP Request Handler with FOH Mobile Remote LAN Gate."""

    def is_localhost_client(self) -> bool:
        client_ip = str(self.client_address[0])
        if client_ip not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return False
        host_hdr = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        if host_hdr and host_hdr not in ("127.0.0.1", "localhost", "[::1]", "::1"):
            return False
        return True

    def log_message(self, format, *args):
        # Suppress noisy polling logs for /api/remote/state
        if "/api/remote/state" in getattr(self, "path", ""):
            return
        sys.stderr.write(f"[{self.log_date_time_string()}] {format % args}\n")

    def send_security_headers(self, content_type: str = "application/json"):
        self.send_header("Content-Type", content_type)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data:; "
            "media-src 'self' blob:; "
            "connect-src 'self'; "
            "frame-ancestors 'none';",
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        is_local = self.is_localhost_client()

        # Security Gate for LAN / Wi-Fi devices (Smartphone Remote)
        if not is_local:
            if not remote_hub.enabled:
                self.send_json(403, {"error": "FOH Mobile Remote sedang dinonaktifkan di Master Deck."})
                return
            if path in ("/", "/index.html"):
                self.send_response(302)
                self.send_header("Location", "/player?remote=1")
                self.end_headers()
                return
            allowed_lan_get = path in (
                "/player",
                "/player.html",
                "/api/system",
                "/api/library",
                "/api/remote/info",
                "/api/remote/state",
            ) or path.startswith("/static/")
            if not allowed_lan_get:
                self.send_json(403, {"error": "Akses jaringan lokal hanya diizinkan untuk FOH Mobile Remote (/player)."})
                return

        if path in ("/", "/index.html"):
            self.serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        elif path in ("/qc", "/qc.html"):
            self.serve_file(STATIC_DIR / "qc.html", "text/html; charset=utf-8")
        elif path in ("/converter", "/converter.html"):
            self.serve_file(STATIC_DIR / "converter.html", "text/html; charset=utf-8")
        elif path in ("/organizer", "/organizer.html"):
            self.serve_file(STATIC_DIR / "organizer.html", "text/html; charset=utf-8")
        elif path in ("/multitrack", "/multitrack.html", "/splitter", "/splitter.html"):
            self.serve_file(STATIC_DIR / "multitrack.html", "text/html; charset=utf-8")
        elif path in ("/video-split", "/video-split.html", "/videosplit", "/videosplit.html"):
            self.serve_file(STATIC_DIR / "video-split.html", "text/html; charset=utf-8")
        elif path in ("/player", "/player.html"):
            self.serve_file(STATIC_DIR / "player.html", "text/html; charset=utf-8")
        elif path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            safe_file = (STATIC_DIR / rel_path).resolve()
            if safe_file.is_relative_to(STATIC_DIR) and safe_file.is_file():
                ext = safe_file.suffix.lower()
                if ext == ".js":
                    mime = "text/javascript; charset=utf-8"
                elif ext == ".css":
                    mime = "text/css; charset=utf-8"
                else:
                    mime, _ = mimetypes.guess_type(str(safe_file))
                self.serve_file(safe_file, mime or "application/octet-stream")
            else:
                self.send_error(404, "File not found")
        elif path == "/api/system":
            self.send_json(200, check_system_binaries())
        elif path == "/api/remote/info":
            qs = parse_qs(parsed.query)
            force_ip = qs.get("refresh", ["0"])[0] == "1"
            interfaces = get_network_interfaces_detail(force_refresh=force_ip)
            lan_ips = get_local_lan_ips(force_refresh=False)
            actual_port = int(self.server.server_address[1])
            remote_port = _get_wsl_remote_bridge_port(actual_port)
            info: dict = {
                "ok": True,
                "is_localhost": is_local,
                "enabled": remote_hub.enabled,
                "port": remote_port,
                "lan_ips": lan_ips,
                "master_online": (time.time() - remote_hub.master_updated_at) < 5.0,
                "active_remotes_count": remote_hub.get_active_remotes_count(),
            }
            if is_local:
                info["pin"] = remote_hub.pin
                info["interfaces"] = [
                    {
                        **iface,
                        "url": f"http://{iface['ip']}:{remote_port}/player?remote=1&pin={remote_hub.pin}",
                    }
                    for iface in interfaces
                ]
                info["remote_urls"] = [
                    f"http://{ip}:{remote_port}/player?remote=1&pin={remote_hub.pin}"
                    for ip in lan_ips
                ]
                info["short_urls"] = [
                    f"http://{ip}:{remote_port}"
                    for ip in lan_ips
                ]
                info["wsl_bridge"] = get_wsl_bridge_status(actual_port)
            self.send_json(200, info)
        elif path == "/api/remote/state":
            if not remote_hub.enabled:
                self.send_json(403, {"ok": False, "error": "FOH Mobile Remote sedang dinonaktifkan.", "code": "DISABLED"})
                return
            qs = parse_qs(parsed.query)
            pin = self.headers.get("X-FOH-PIN") or qs.get("pin", [None])[0]
            if not remote_hub.verify_pin(pin):
                self.send_json(401, {"ok": False, "error": "PIN FOH Remote tidak valid atau belum dimasukkan.", "code": "INVALID_PIN"})
                return
            client_tag = self.headers.get("X-FOH-Client-ID") or "mobile"
            client_id = f"{self.client_address[0]}:{client_tag[:32]}"
            self.send_json(200, remote_hub.get_remote_state(client_id))
        elif path == "/api/queue":
            self.send_json(200, task_manager.get_snapshot(history_limit=10))
        elif path == "/api/library":
            qs = parse_qs(parsed.query)
            raw_src = qs.get("source_dir", [None])[0]
            try:
                src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
                files_data, playlists_data = self.get_library_files(src_dir)
                self.send_json(200, {
                    "files": files_data,
                    "playlists": playlists_data,
                    "source_dir": str(src_dir),
                    "default_inbox": str(INBOX_DIR.resolve()),
                })
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
        elif path == "/api/stream":
            qs = parse_qs(parsed.query)
            raw_src = qs.get("source_dir", [None])[0]
            rel_path = qs.get("rel_path", [None])[0]
            try:
                target_file, mime_type = fs_browser.resolve_safe_audio_file(raw_src, rel_path, INBOX_DIR)
                self.serve_audio_stream(target_file, mime_type)
            except FileNotFoundError as exc:
                self.send_json(404, {"error": str(exc)})
            except Exception as exc:
                self.send_json(400, {"error": str(exc)})
        else:
            self.send_error(404, "Endpoint not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        is_local = self.is_localhost_client()

        if not is_local:
            if not remote_hub.enabled:
                self.send_json(403, {"error": "FOH Mobile Remote sedang dinonaktifkan di Master Deck."})
                return
            if path != "/api/remote/command":
                self.send_json(403, {"error": "Operasi ini hanya diizinkan langsung dari Master Laptop/PC."})
                return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 1024 * 1024:  # 1MB limit for JSON payload
            self.send_error(413, "Payload too large")
            return

        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            self.send_json(400, {"error": "Invalid JSON"})
            return

        if path == "/api/remote/wsl-bridge":
            if not is_local:
                self.send_json(403, {"error": "Hanya Master Deck lokal yang dapat mengatur bridge WSL2."})
                return
            actual_port = int(self.server.server_address[1])
            if payload.get("action") == "disable":
                ok_bridge, msg_bridge, status_bridge = disable_wsl_port_bridge(actual_port)
            else:
                ok_bridge, msg_bridge, status_bridge = enable_wsl_port_bridge(actual_port)
            self.send_json(200 if ok_bridge else 400, {
                "ok": ok_bridge,
                "message": msg_bridge,
                "wsl_bridge": status_bridge,
            })
        elif path == "/api/remote/state":
            if not is_local:
                self.send_json(403, {"error": "Hanya Master Deck lokal yang dapat memperbarui state."})
                return
            if payload.get("regenerate_pin"):
                remote_hub.regenerate_pin()
            if "enabled" in payload and isinstance(payload["enabled"], bool):
                remote_hub.set_enabled(payload["enabled"])
            commands, active_count, current_pin, is_enabled = remote_hub.update_master_state(payload.get("state"))
            self.send_json(200, {
                "ok": True,
                "commands": commands,
                "active_remotes_count": active_count,
                "pin": current_pin,
                "enabled": is_enabled,
                "lan_ips": get_local_lan_ips(),
                "port": int(self.server.server_address[1]),
            })
        elif path == "/api/remote/command":
            if not remote_hub.enabled:
                self.send_json(403, {"ok": False, "error": "FOH Mobile Remote sedang dinonaktifkan.", "code": "DISABLED"})
                return
            pin = self.headers.get("X-FOH-PIN") or payload.get("pin")
            if not remote_hub.verify_pin(pin):
                self.send_json(401, {"ok": False, "error": "PIN FOH Remote tidak valid.", "code": "INVALID_PIN"})
                return
            action = str(payload.get("action") or "").strip()
            if action not in ALLOWED_REMOTE_ACTIONS:
                self.send_json(400, {"ok": False, "error": f"Action '{action}' tidak dikenali."})
                return
            client_tag = self.headers.get("X-FOH-Client-ID") or "mobile"
            client_id = f"{self.client_address[0]}:{client_tag[:32]}"
            cmd = remote_hub.enqueue_command(action, payload.get("params"), client_id)
            self.send_json(200, {"ok": True, "command_id": cmd["id"]})
        elif path == "/api/download":
            status, resp = task_manager.enqueue_downloads(payload)
            self.send_json(status, resp)
        elif path == "/api/scan":
            self._handle_post_scan(payload)
        elif path == "/api/browse-dirs":
            self._handle_post_browse_dirs(payload)
        elif path == "/api/probe":
            self._handle_post_probe(payload)
        elif path == "/api/resample":
            status, resp = task_manager.enqueue_resample(payload)
            self.send_json(status, resp)
        elif path == "/api/open-folder":
            self._handle_post_open_folder(payload)
        elif path == "/api/rename":
            self._handle_post_rename(payload)
        elif path == "/api/batch-rename":
            self._handle_post_batch_rename(payload)
        elif path == "/api/delete":
            self._handle_post_delete(payload)
        elif path == "/api/splitter/inspect":
            self._handle_post_splitter_inspect(payload)
        elif path == "/api/splitter/detect":
            self._handle_post_splitter_detect(payload)
        elif path == "/api/splitter/youtube-info":
            self._handle_post_splitter_youtube_info(payload)
        elif path == "/api/splitter/execute":
            status, resp = task_manager.enqueue_split(payload)
            self.send_json(status, resp)
        else:
            self.send_error(404, "Endpoint not found")

    def _handle_post_scan(self, payload: dict | None = None) -> None:
        raw_src = (payload or {}).get("source_dir")
        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            results = metadata_cache.scan_library(src_dir)
            self.send_json(200, {"message": "Audit selesai", "results": results})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def _handle_post_browse_dirs(self, payload: dict) -> None:
        try:
            result = fs_browser.browse_directory(
                raw_path=payload.get("path"),
                create_subfolder=payload.get("create_subfolder"),
                default_inbox=INBOX_DIR,
            )
            self.send_json(200, result)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_probe(self, payload: dict) -> None:
        folder = payload.get("folder")
        raw_src = payload.get("source_dir")
        try:
            source_resolved = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})
            return

        if not source_resolved.exists():
            self.send_json(200, {"files": [], "playlists": [], "source_dir": str(source_resolved)})
            return

        if folder == "__ROOT__":
            target_files = [
                p for p in source_resolved.iterdir()
                if p.is_file() and p.suffix.lower() in audio_manager.EXTENSIONS and not p.name.startswith(".")
            ]
        elif isinstance(folder, str) and folder.strip():
            pl_dir = (source_resolved / folder.strip()).resolve()
            if not pl_dir.is_relative_to(source_resolved) or not pl_dir.is_dir():
                self.send_json(400, {"error": "Folder playlist tidak ditemukan."})
                return
            target_files = iter_audio_files_safe(pl_dir)
        else:
            target_files = iter_audio_files_safe(source_resolved)

        include_spectral = bool(payload.get("probe_spectral", True))
        metadata_cache.probe_files_fast(target_files, include_spectral=include_spectral)
        files_data, playlists_data = self.get_library_files(source_resolved)
        self.send_json(200, {
            "files": files_data,
            "playlists": playlists_data,
            "source_dir": str(source_resolved),
        })

    def _handle_post_open_folder(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        raw_folder = payload.get("folder")
        try:
            base = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            if raw_folder and isinstance(raw_folder, str) and raw_folder.strip():
                folder_str = raw_folder.strip()
                if Path(folder_str).is_absolute() or folder_str.startswith("/mnt/"):
                    target = resolve_safe_dir(folder_str, must_exist=True)
                else:
                    target = (base / folder_str).resolve()
                    if not target.is_relative_to(base) or not target.exists():
                        self.send_json(400, {"error": "Folder tidak ditemukan atau berada di luar batas direktori."})
                        return
            else:
                target = base

            ok, msg = fs_browser.open_in_file_manager(target)
            if ok:
                self.send_json(200, {"ok": True, "message": msg, "path": str(target)})
            else:
                self.send_json(500, {"ok": False, "error": msg})
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_rename(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_path = payload.get("rel_path")
        new_name = payload.get("new_name")
        is_folder = payload.get("is_folder")

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, old_p, new_p = fs_browser.rename_fs_entry(
                source_dir=src_dir,
                rel_path=rel_path or "",
                new_name=new_name or "",
                is_folder=is_folder,
            )
            if not ok:
                self.send_json(400, {"error": msg})
                return

            # Update cache keys
            if new_p.is_dir():
                metadata_cache.rename_folder(old_p, new_p)
            else:
                metadata_cache.rename_entry(old_p, new_p)

            self.send_json(200, {
                "ok": True,
                "message": msg,
                "old_name": old_p.name,
                "new_name": new_p.name,
                "rel_path": str(new_p.relative_to(src_dir)),
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_batch_rename(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_paths = payload.get("rel_paths")
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        preview_only = bool(payload.get("preview_only", False))

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, plan = fs_browser.batch_rename_entries(
                source_dir=src_dir,
                rel_paths=rel_paths if isinstance(rel_paths, list) else [],
                options=options,
                preview_only=preview_only,
            )
            if not ok:
                self.send_json(400, {"error": msg})
                return

            if not preview_only:
                for item in plan:
                    if item.get("changed"):
                        metadata_cache.rename_entry(item["old_path"], item["new_path"])

            changed_count = sum(1 for item in plan if item.get("changed"))
            self.send_json(200, {
                "ok": True,
                "message": msg,
                "preview_only": preview_only,
                "changed_count": changed_count,
                "total_count": len(plan),
                "plan": [
                    {
                        "rel_path": item["rel_path"],
                        "new_rel_path": item["new_rel_path"],
                        "folder": item["folder"],
                        "old_name": item["old_name"],
                        "new_name": item["new_name"],
                        "changed": item["changed"],
                    }
                    for item in plan
                ],
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_delete(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_path = payload.get("rel_path")
        rel_paths = payload.get("rel_paths")
        is_folder = payload.get("is_folder")

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, deleted_files, deleted_folders = fs_browser.delete_fs_entries(
                source_dir=src_dir,
                rel_paths=rel_paths if isinstance(rel_paths, list) else None,
                rel_path=rel_path if isinstance(rel_path, str) else None,
                is_folder=is_folder if isinstance(is_folder, bool) else None,
            )
            if not ok:
                self.send_json(400, {"error": msg})
                return

            # Evict deleted files and folders from metadata/QC cache
            for fp in deleted_files:
                metadata_cache.remove_entry(fp)
            for dp in deleted_folders:
                metadata_cache.remove_folder(dp)

            # Sync download archive if deletions occurred inside default INBOX_DIR
            inbox_resolved = INBOX_DIR.resolve()
            if src_dir == inbox_resolved or src_dir.is_relative_to(inbox_resolved):
                audio_manager.sync_download_archive(inbox_resolved, ARCHIVE_FILE)

            self.send_json(200, {
                "ok": True,
                "message": msg,
                "deleted_count": len(deleted_files),
                "deleted_paths": [str(p.relative_to(src_dir)) for p in deleted_files if p.is_relative_to(src_dir)],
                "deleted_folders": [str(d.relative_to(src_dir)) for d in deleted_folders if d.is_relative_to(src_dir)],
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_splitter_inspect(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        raw_rel = payload.get("target_rel")
        probe_detail = bool(payload.get("probe_detail", False))
        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            dir_data = splitter_engine.inspect_splitter_directory(src_dir)
            dir_data["default_inbox"] = str(INBOX_DIR.resolve())

            if raw_rel and isinstance(raw_rel, str) and raw_rel.strip():
                target_file = splitter_engine.validate_safe_file_path(raw_rel.strip(), base_dir=src_dir)
                dir_data["selected_probe"] = splitter_engine.probe_media_detailed(target_file)
            elif probe_detail and dir_data.get("files"):
                # Probe up to 15 direct files for quick channel/duration badges
                probed_map: dict[str, dict] = {}
                for item in dir_data["files"][:15]:
                    try:
                        fp = splitter_engine.validate_safe_file_path(item["rel_path"], base_dir=src_dir)
                        probed_map[item["rel_path"]] = splitter_engine.probe_media_detailed(fp)
                    except Exception:
                        pass
                dir_data["probed_files"] = probed_map

            self.send_json(200, dir_data)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_splitter_youtube_info(self, payload: dict) -> None:
        url = (payload or {}).get("url") or (payload or {}).get("youtube_url")
        if not url or not splitter_engine.is_youtube_url(url):
            self.send_json(400, {"error": "URL YouTube tidak valid. Pastikan link youtube.com atau youtu.be."})
            return
        try:
            info = splitter_engine.fetch_youtube_video_info(str(url).strip())
            self.send_json(200, info)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_splitter_detect(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        raw_target_rel = payload.get("target_rel")
        target_mode = str(payload.get("target_mode", "auto")).strip().lower()
        detect_mode = str(payload.get("detect_mode", "auto")).strip().lower()
        noise_db = float(payload.get("noise_db", -32.0))
        min_silence_s = float(payload.get("min_silence_s", 2.5))
        min_song_s = float(payload.get("min_song_s", 60.0))
        pad_before_s = float(payload.get("pad_before_s", 0.5))
        pad_after_s = float(payload.get("pad_after_s", 1.0))
        trim_silence_edges = bool(payload.get("trim_silence_edges", True))
        reference_stem = payload.get("reference_stem")
        channel_mode = str(payload.get("channel_mode", "auto")).strip().lower()
        manual_timestamps = payload.get("manual_timestamps")

        try:
            yt_url = payload.get("youtube_url") or (raw_target_rel if splitter_engine.is_youtube_url(raw_target_rel) else None)
            if yt_url:
                target_path = str(yt_url).strip()
            else:
                src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
                if target_mode == "folder_stems" or not raw_target_rel:
                    target_path = src_dir
                else:
                    target_path = splitter_engine.validate_safe_file_path(str(raw_target_rel), base_dir=src_dir)

            result = splitter_engine.detect_song_segments(
                target_path=target_path,
                mode=detect_mode,
                noise_db=noise_db,
                min_silence_s=min_silence_s,
                min_song_s=min_song_s,
                pad_before_s=pad_before_s,
                pad_after_s=pad_after_s,
                trim_silence_edges=trim_silence_edges,
                reference_stem=str(reference_stem) if reference_stem else None,
                channel_mode=channel_mode,
                manual_timestamps=str(manual_timestamps) if manual_timestamps else None,
            )
            self.send_json(200, result)
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def serve_file(self, file_path: Path, content_type: str):
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_security_headers(content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as exc:
            self.send_error(500, f"Error reading file: {exc}")

    def serve_audio_stream(self, file_path: Path, content_type: str):
        """Streams an audio file with HTTP Range (206 Partial Content) support for instant seeking."""
        try:
            file_size = file_path.stat().st_size
        except OSError:
            self.send_error(404, "Audio file not found")
            return

        range_header = self.headers.get("Range")
        start = 0
        end = max(0, file_size - 1)
        is_partial = False

        if range_header and range_header.strip().startswith("bytes=") and file_size > 0:
            raw_range = range_header.strip()[len("bytes="):].split(",")[0].strip()
            if "-" in raw_range:
                start_str, end_str = raw_range.split("-", 1)
                try:
                    if start_str == "":
                        suffix_len = int(end_str)
                        start = max(0, file_size - suffix_len)
                        end = file_size - 1
                    else:
                        start = int(start_str)
                        end = int(end_str) if end_str else (file_size - 1)
                    if 0 <= start <= end < file_size:
                        is_partial = True
                    else:
                        self.send_response(416)
                        self.send_security_headers(content_type)
                        self.send_header("Content-Range", f"bytes */{file_size}")
                        self.end_headers()
                        return
                except ValueError:
                    is_partial = False

        content_length = (end - start + 1) if file_size > 0 else 0
        try:
            with open(file_path, "rb") as f:
                if is_partial:
                    self.send_response(206)
                    self.send_security_headers(content_type)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                    self.send_header("Content-Length", str(content_length))
                    self.end_headers()
                    f.seek(start)
                else:
                    self.send_response(200)
                    self.send_security_headers(content_type)
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(file_size))
                    self.end_headers()

                remaining = content_length
                chunk_size = 65536
                while remaining > 0:
                    chunk = f.read(min(chunk_size, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            # Normal when browser/WebView seeks or switches tracks mid-stream
            return
        except Exception as exc:
            sys.stderr.write(f"[Stream Error] {exc}\n")

    def send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_security_headers("application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_library_files(self, base_dir: Path | None = None) -> tuple[list[dict], list[dict]]:
        return metadata_cache.get_library_files(base_dir or INBOX_DIR)

    def scan_library(self) -> list[dict]:
        return metadata_cache.scan_library(INBOX_DIR)


_worker_started = False
_worker_lock = threading.Lock()


def ensure_worker_started() -> None:
    """Starts the background FIFO task worker thread once."""
    global _worker_started
    with _worker_lock:
        if not _worker_started:
            worker_thread = threading.Thread(target=run_worker, daemon=True)
            worker_thread.start()
            _worker_started = True


def create_server(host: str = "0.0.0.0", port: int = 8765) -> tuple[ThreadingHTTPServer, int]:
    """Starts the background worker and creates the HTTP server, falling back to a free port if needed."""
    ensure_worker_started()
    _cleanup_stale_wsl_listen_port(port)
    ThreadingHTTPServer.allow_reuse_address = True
    try:
        server = ThreadingHTTPServer((host, port), AudioServerHandler)
    except OSError:
        try:
            server = ThreadingHTTPServer((host, 0), AudioServerHandler)
        except OSError:
            server = ThreadingHTTPServer(("127.0.0.1", 0), AudioServerHandler)
    actual_port = int(server.server_address[1])
    return server, actual_port


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "-m" and sys.argv[2] == "yt_dlp":
        sys.argv = ["yt-dlp"] + sys.argv[3:]
        import yt_dlp

        yt_dlp.main()
        return

    bind_host = "0.0.0.0"  # Listens on LAN for FOH Mobile Remote (gated by PIN & localhost checks)
    local_host = "127.0.0.1"
    port = 8765

    server, actual_port = create_server(bind_host, port)
    remote_port = _get_wsl_remote_bridge_port(actual_port)
    lan_ips = get_local_lan_ips(force_refresh=True)
    print("=" * 65)
    print("  SWARARIA AUDIO LAB // BATCH INGESTION & SOUNDSYSTEM QC ENGINE")
    print("=" * 65)
    print(f"  Server running locally at : http://{local_host}:{actual_port}")
    if lan_ips:
        print(f"  FOH Mobile Remote (HP)    : http://{lan_ips[0]}:{remote_port}/player?remote=1")
        print(f"  FOH Remote Security PIN   : {remote_hub.pin}")
    print(f"  Inbox Folder              : {INBOX_DIR}")
    print("  Press Ctrl+C to stop.")
    print("=" * 65)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server gracefully...")
        server.server_close()


if __name__ == "__main__":
    main()
