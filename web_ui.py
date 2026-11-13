#!/usr/bin/env python3
"""Audio Library Web UI: Localhost Server for Batch Ingestion & QC Monitoring.

Designed for audio engineers and programmers.
Listens strictly on 127.0.0.1 for maximum local security.
"""
from __future__ import annotations

import base64
import hmac
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
import urllib.error
import urllib.parse
import urllib.request

import audio_manager
import fs_browser
import splitter_engine
from task_engine import AudioMetadataCache, TaskQueueManager

APP_VERSION = "1.0.0"
GITHUB_REPO = "dediks/audio-library"
BASE_DIR = fs_browser.BASE_DIR
RESOURCE_DIR = fs_browser.RESOURCE_DIR
STATIC_DIR = RESOURCE_DIR / "static"
INBOX_DIR = fs_browser.INBOX_DIR
ARCHIVE_FILE = BASE_DIR / "library" / "downloaded_ids.txt"
COOKIES_FILE = BASE_DIR / "library" / "cookies.txt"
GITHUB_TOKEN_FILE = BASE_DIR / "library" / "github_token.txt"

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
        "app_version": APP_VERSION,
        "github_repo": GITHUB_REPO,
    }


def _parse_semver(ver_str: str) -> tuple[int, ...]:
    """Extracts numeric semver components from version strings like 'v1.0.2' or '1.0.0'."""
    clean = re.sub(r"^[vV]\.?", "", str(ver_str).strip())
    parts = []
    for token in clean.split("."):
        m = re.match(r"^(\d+)", token)
        if m:
            parts.append(int(m.group(1)))
        else:
            break
    return tuple(parts) or (0,)


def check_for_updates() -> dict:
    """Queries GitHub Releases API for dediks/audio-library and checks for new versions."""
    api_url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    headers = {
        "User-Agent": f"SwarariaAudioLab/{APP_VERSION}",
        "Accept": "application/vnd.github.v3+json",
    }

    # Optional GitHub token for private repo access
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token and GITHUB_TOKEN_FILE.is_file():
        try:
            token = GITHUB_TOKEN_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = Request(api_url, headers=headers)
    try:
        with urlopen(req, timeout=5.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            tag = str(data.get("tag_name", "")).strip()
            latest_tuple = _parse_semver(tag)
            current_tuple = _parse_semver(APP_VERSION)
            has_update = latest_tuple > current_tuple

            download_url = None
            asset_size = 0
            asset_name = ""
            for asset in data.get("assets", []):
                name = str(asset.get("name", ""))
                if name.lower().endswith(".exe"):
                    download_url = asset.get("browser_download_url")
                    asset_size = asset.get("size", 0)
                    asset_name = name
                    break

            return {
                "ok": True,
                "has_update": has_update,
                "current_version": APP_VERSION,
                "latest_version": tag,
                "release_name": data.get("name") or tag,
                "release_notes": data.get("body") or "",
                "html_url": data.get("html_url") or f"https://github.com/{GITHUB_REPO}/releases",
                "download_url": download_url,
                "asset_size": asset_size,
                "asset_name": asset_name,
                "published_at": data.get("published_at", ""),
            }
    except HTTPError as err:
        if err.code == 404:
            return {
                "ok": True,
                "has_update": False,
                "current_version": APP_VERSION,
                "latest_version": APP_VERSION,
                "message": "Belum ada rilis publik di GitHub Repository ini (atau repo privat butuh token).",
                "html_url": f"https://github.com/{GITHUB_REPO}",
            }
        elif err.code == 403:
            return {
                "ok": False,
                "has_update": False,
                "current_version": APP_VERSION,
                "error": "Akses GitHub API mencapai batas (rate limit) atau repo privat membutuhkan token.",
                "html_url": f"https://github.com/{GITHUB_REPO}",
            }
        return {
            "ok": False,
            "has_update": False,
            "current_version": APP_VERSION,
            "error": f"GitHub API HTTP {err.code}: {err.reason}",
            "html_url": f"https://github.com/{GITHUB_REPO}",
        }
    except URLError as err:
        return {
            "ok": False,
            "has_update": False,
            "current_version": APP_VERSION,
            "error": f"Gagal terhubung ke GitHub: {err.reason}",
            "html_url": f"https://github.com/{GITHUB_REPO}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "has_update": False,
            "current_version": APP_VERSION,
            "error": f"Kesalahan saat memeriksa pembaruan: {exc}",
            "html_url": f"https://github.com/{GITHUB_REPO}",
        }


def install_update_package(download_url: str) -> tuple[bool, str]:
    """Downloads the release asset installer and executes it for seamless update."""
    if not isinstance(download_url, str) or not download_url.startswith(f"https://github.com/{GITHUB_REPO}/releases/download/"):
        return False, "URL unduhan tidak sah atau di luar domain rilis resmi GitHub."

    temp_dir = Path(tempfile.gettempdir()).resolve()
    target_installer = temp_dir / "SwarariaAudioLab_Update_Setup.exe"

    headers = {"User-Agent": f"SwarariaAudioLab/{APP_VERSION}"}
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token and GITHUB_TOKEN_FILE.is_file():
        try:
            token = GITHUB_TOKEN_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = Request(download_url, headers=headers)
    try:
        with urlopen(req, timeout=120.0) as resp, open(target_installer, "wb") as out_f:
            shutil.copyfileobj(resp, out_f)
    except Exception as exc:
        return False, f"Gagal mengunduh installer pembaruan: {exc}"

    if not target_installer.is_file() or target_installer.stat().st_size < 1024 * 1024:
        return False, "File unduhan installer tidak lengkap atau rusak."

    try:
        if os.name == "nt":
            subprocess.Popen([str(target_installer), "/CLOSEAPPLICATIONS"])
        elif is_wsl_environment():
            pass

        def _delayed_shutdown():
            time.sleep(1.5)
            os._exit(0)

        threading.Thread(target=_delayed_shutdown, daemon=True).start()
        return True, "Installer pembaruan berhasil diunduh dan diluncurkan. Aplikasi akan ditutup untuk memperbarui."
    except Exception as exc:
        return False, f"Gagal menjalankan installer pembaruan: {exc}"


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


def _is_rfc1918_ipv4(candidate: str) -> bool:
    try:
        ip = ipaddress.IPv4Address(candidate.strip())
    except (ValueError, ipaddress.AddressValueError):
        return False
    return any(ip in ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


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
            stdin=subprocess.DEVNULL,
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
                label = f"Virtual ({short_name})"
                reachable = False
                priority = 90
            elif is_wifi:
                kind = "wifi"
                label = f"Wi-Fi ({short_name})"
                reachable = True
                priority = 1 if curr_gw else 2
            else:
                kind = "lan"
                label = f"LAN ({short_name})"
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
                "label": "WSL2 Internal IP",
                "kind": "wsl_internal",
                "has_gateway": True,
                "reachable_from_hp": False,
                "priority": 95,
            })
        else:
            interfaces.append({
                "ip": ip,
                "adapter": "Local Network",
                "label": "Wi-Fi / LAN",
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
            stdin=subprocess.DEVNULL,
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
            stdin=subprocess.DEVNULL,
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


_wsl_foh_ports_lock = threading.Lock()
_active_wsl_foh_ports: dict[int, int] = {}


def _get_wsl_foh_internal_port(server_port: int) -> int:
    """Returns the internal WSL2 loopback port for the dedicated bridged FOH listener."""
    with _wsl_foh_ports_lock:
        active = _active_wsl_foh_ports.get(int(server_port))
    if active:
        return active
    bridge_port = _get_wsl_remote_bridge_port(server_port)
    reserved = {int(server_port), int(bridge_port)}
    try:
        android_pub = _get_native_remote_default_port(int(server_port))
        reserved.add(android_pub)
        reserved.add(_get_wsl_native_internal_port(android_pub, int(server_port), _include_foh_internal=False))
    except Exception:
        reserved.update({8767, 8768})
    for delta in range(1, 32):
        candidate = bridge_port + delta
        if 1024 <= candidate <= 65535 and candidate not in reserved:
            return candidate
    for delta in range(1, 32):
        candidate = int(server_port) - delta
        if 1024 <= candidate <= 65535 and candidate not in reserved:
            return candidate
    return 8769


def _foh_bridge_script_lines(
    port: int,
    bridge_port: int,
    internal_port: int,
    wifi_ip: str,
    quiet: bool = False,
) -> list[str]:
    suffix = " | Out-Null;" if quiet else ""
    rule_name = f"Swararia FOH Remote {bridge_port}"
    parts: list[str] = [
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress=0.0.0.0{suffix}",
    ]
    if wifi_ip:
        parts.append(f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={wifi_ip}{suffix}")
    parts.append(f'netsh advfirewall firewall delete rule name="Swararia FOH Remote {port}"{suffix}')
    parts.extend(_native_bridge_script_lines(True, bridge_port, internal_port, wifi_ip, rule_name, quiet=quiet))
    return parts


def get_wsl_bridge_status(port: int) -> dict:
    """Checks if Windows portproxy is forwarding Wi-Fi IP:8766 -> 127.0.0.1:8769 (bridged WSL2 FOH listener)."""
    if not is_wsl_environment():
        return {"is_wsl": False, "bridge_active": True, "bridge_port": port}

    bridge_port = _get_wsl_remote_bridge_port(port)
    internal_port = _get_wsl_foh_internal_port(port)
    wsl_ips = _get_linux_internal_ips()
    wsl_ip = wsl_ips[0] if wsl_ips else ""
    lan_ips = get_local_lan_ips(force_refresh=False)
    wifi_ip = lan_ips[0] if lan_ips else ""
    rule_name = f"Swararia FOH Remote {bridge_port}"

    rules = _list_windows_portproxy_rules()
    valid_addrs = {"0.0.0.0", "*"}
    if wifi_ip:
        valid_addrs.add(wifi_ip)
    has_primary_rule = any(
        lp == bridge_port and la in valid_addrs and (ca, cp) == ("127.0.0.1", internal_port)
        for (la, lp, ca, cp) in rules
    )
    has_fallback_rule = bool(wsl_ip) and any(
        lp == bridge_port and la in valid_addrs and (ca, cp) in {(wsl_ip, port), (wsl_ip, internal_port)}
        for (la, lp, ca, cp) in rules
    )
    firewall_active = _check_windows_firewall_rule(rule_name) if _find_windows_sys32_bin("netsh.exe") else True

    if wifi_ip and _find_windows_sys32_bin("curl.exe"):
        has_rule = has_primary_rule or has_fallback_rule
        bridge_active = has_rule and firewall_active and _verify_windows_http_reachable(wifi_ip, bridge_port)
    else:
        has_rule = has_primary_rule
        bridge_active = has_rule and firewall_active

    ps_parts = _foh_bridge_script_lines(port, bridge_port, internal_port, wifi_ip, quiet=False)
    return {
        "is_wsl": True,
        "wsl_ip": wsl_ip,
        "wifi_ip": wifi_ip,
        "bridge_port": bridge_port,
        "internal_port": internal_port,
        "bridge_active": bridge_active,
        "powershell_admin_cmd": "; ".join(ps_parts),
    }


def enable_wsl_port_bridge(port: int) -> tuple[bool, str, dict]:
    """Launches an elevated Windows PowerShell UAC prompt to bridge Wi-Fi port 8766 -> 127.0.0.1:8769 (wslrelay)."""
    status = get_wsl_bridge_status(port)
    if not status.get("is_wsl"):
        return True, "Bukan lingkungan WSL2 (tidak memerlukan bridge).", status
    bridge_port = _get_wsl_remote_bridge_port(port)
    internal_port = int(status.get("internal_port") or _get_wsl_foh_internal_port(port))
    wsl_ip = status.get("wsl_ip") or ""

    lan_ips = get_local_lan_ips(force_refresh=True)
    wifi_ip = lan_ips[0] if lan_ips else ""
    listen_addr = wifi_ip if wifi_ip else "0.0.0.0"

    if not _find_windows_sys32_bin("powershell.exe"):
        return False, "powershell.exe tidak ditemukan dari WSL2.", status

    inner_lines = _foh_bridge_script_lines(port, bridge_port, internal_port, wifi_ip, quiet=True)
    if wifi_ip and wsl_ip:
        inner_lines.extend([
            f"$code = (& curl.exe -s -o NUL -w '%{{http_code}}' --max-time 2 'http://{wifi_ip}:{bridge_port}/api/system');",
            "if ($code -ne '200') {",
            f"  try {{ New-NetFirewallHyperVRule -Name 'SwarariaFOH{port}' -DisplayName 'Swararia FOH Remote {port}' -Direction Inbound -VMCreatorId '{{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}}' -Protocol TCP -LocalPorts {port} -Action Allow -ErrorAction SilentlyContinue | Out-Null; }} catch {{}}",
            f"  netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 | Out-Null;",
            f"  netsh interface portproxy add v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 connectport={port} connectaddress={wsl_ip} | Out-Null;",
            "}",
        ])

    ok_exec, exec_err = _run_elevated_windows_powershell(inner_lines, timeout=35.0)
    if not ok_exec:
        return False, f"Gagal menjalankan PowerShell UAC: {exec_err}", get_wsl_bridge_status(port)

    updated = get_wsl_bridge_status(port)
    if updated.get("bridge_active"):
        return (
            True,
            f"Jembatan Port {bridge_port} ({listen_addr}:{bridge_port} -> 127.0.0.1:{internal_port}) berhasil diaktifkan & terverifikasi!",
            updated,
        )
    return (
        False,
        "Jembatan belum merespons HTTP 200 (Pastikan Anda klik 'Yes' pada jendela konfirmasi Admin Windows).",
        updated,
    )


def disable_wsl_port_bridge(port: int) -> tuple[bool, str, dict]:
    """Removes the Windows portproxy rule and firewall rules for the specified FOH bridge port."""
    status = get_wsl_bridge_status(port)
    if not status.get("is_wsl"):
        return True, "Bukan lingkungan WSL2.", status

    bridge_port = _get_wsl_remote_bridge_port(port)
    internal_port = int(status.get("internal_port") or _get_wsl_foh_internal_port(port))
    lan_ips = get_local_lan_ips(force_refresh=True)
    wifi_ip = lan_ips[0] if lan_ips else ""
    if not _find_windows_sys32_bin("powershell.exe"):
        return False, "powershell.exe tidak ditemukan.", status

    inner_lines = [
        f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress=0.0.0.0 | Out-Null;",
        f"netsh interface portproxy delete v4tov4 listenport={internal_port} listenaddress=0.0.0.0 | Out-Null;",
    ]
    if wifi_ip:
        inner_lines.extend([
            f"netsh interface portproxy delete v4tov4 listenport={port} listenaddress={wifi_ip} | Out-Null;",
            f"netsh interface portproxy delete v4tov4 listenport={bridge_port} listenaddress={wifi_ip} | Out-Null;",
            f"netsh interface portproxy delete v4tov4 listenport={internal_port} listenaddress={wifi_ip} | Out-Null;",
        ])
    inner_lines.extend([
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {port}\" | Out-Null;",
        f"netsh advfirewall firewall delete rule name=\"Swararia FOH Remote {bridge_port}\" | Out-Null;",
        "try {",
        f"  Remove-NetFirewallHyperVRule -Name 'SwarariaFOH{port}' -ErrorAction SilentlyContinue;",
        "  Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Block -ErrorAction SilentlyContinue | Out-Null;",
        "} catch {}",
    ])

    ok_exec, exec_err = _run_elevated_windows_powershell(inner_lines, timeout=30.0)
    if not ok_exec:
        return False, f"Gagal menutup jembatan port: {exec_err}", get_wsl_bridge_status(port)

    updated = get_wsl_bridge_status(port)
    return True, f"Jembatan Port {bridge_port} & aturan Firewall telah dihapus kembali (Tertutup Rapat).", updated


def _get_native_remote_default_port(http_port: int) -> int:
    """Returns default Android Remote port, skipping web UI and FOH WSL bridge ports."""
    is_wsl = is_wsl_environment()
    reserved = {http_port}
    if is_wsl:
        reserved.add(_get_wsl_remote_bridge_port(http_port))
    port = 8767 if is_wsl else 8766
    limit = 65534 if is_wsl else 65535
    while port in reserved and port < limit:
        port += 1
    if port in reserved:
        port = 8766
        while port in reserved and port > 1024:
            port -= 1
    return port


def _get_wsl_native_internal_port(
    public_port: int,
    http_port: int,
    _include_foh_internal: bool = True,
) -> int:
    """Chooses an internal WSL2 loopback port distinct from public_port, web UI, and FOH bridge."""
    reserved = {public_port, http_port, _get_wsl_remote_bridge_port(http_port)}
    if _include_foh_internal:
        reserved.add(_get_wsl_foh_internal_port(http_port))
    for delta in range(1, 32):
        for candidate in (public_port + delta, public_port - delta):
            if 1024 <= candidate <= 65535 and candidate not in reserved:
                return candidate
    return 8768


def _list_windows_portproxy_rules() -> list[tuple[str, int, str, int]]:
    netsh_bin = _find_windows_sys32_bin("netsh.exe")
    if not netsh_bin:
        return []
    rules: list[tuple[str, int, str, int]] = []
    try:
        out = subprocess.check_output(
            [netsh_bin, "interface", "portproxy", "show", "v4tov4"],
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.5,
        )
        for line in out.splitlines():
            m = re.match(
                r"^\s*(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)\s+(\d{1,3}(?:\.\d{1,3}){3}|\*)\s+(\d+)",
                line,
            )
            if m:
                rules.append((m.group(1), int(m.group(2)), m.group(3), int(m.group(4))))
    except Exception:
        pass
    return rules


def _check_windows_firewall_rule(rule_name: str) -> bool:
    netsh_bin = _find_windows_sys32_bin("netsh.exe")
    if not netsh_bin:
        return False
    try:
        proc = subprocess.run(
            [netsh_bin, "advfirewall", "firewall", "show", "rule", f"name={rule_name}"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.5,
            check=False,
        )
        if proc.returncode != 0:
            return False
        low = proc.stdout.lower()
        return ("enabled:" in low and "yes" in low and "direction:" in low and "in" in low)
    except Exception:
        return False


def _verify_windows_tls_reachable(ip: str, port: int) -> bool:
    """Tests from Windows host side whether https://ip:port/v1/state responds with HTTP 401 from NativeTLSServer."""
    if not ip or not _is_rfc1918_ipv4(ip):
        return False
    curl_bin = _find_windows_sys32_bin("curl.exe")
    if not curl_bin:
        return False
    try:
        out = subprocess.check_output(
            [
                curl_bin,
                "-sk",
                "-o",
                "NUL",
                "-w",
                "%{http_code}",
                "--max-time",
                "1.5",
                f"https://{ip}:{int(port)}/v1/state",
            ],
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=2.5,
        ).strip()
        return out == "401"
    except Exception:
        return False


def _run_elevated_windows_powershell(inner_lines: list[str], timeout: float = 35.0) -> tuple[bool, str]:
    ps_bin = _find_windows_sys32_bin("powershell.exe")
    if not ps_bin:
        return False, "powershell.exe tidak ditemukan dari lingkungan ini."
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
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=timeout,
            check=False,
        )
        return True, ""
    except Exception as exc:
        return False, str(exc)


def _validated_bridge_target(http_port: int, public_port: int | None, wifi_ip: str, native_local_port: int | None) -> tuple[int, int, str]:
    default_port = _get_native_remote_default_port(http_port)
    eff_port = int(public_port) if isinstance(public_port, int) and not isinstance(public_port, bool) and 1 <= public_port <= 65535 else default_port
    eff_ip = wifi_ip.strip() if isinstance(wifi_ip, str) and _is_rfc1918_ipv4(wifi_ip) else ""
    if not eff_ip:
        rfc_ips = [ip for ip in get_local_lan_ips(force_refresh=False) if _is_rfc1918_ipv4(ip)]
        eff_ip = rfc_ips[0] if rfc_ips else ""
    eff_local = int(native_local_port) if isinstance(native_local_port, int) and not isinstance(native_local_port, bool) and 1 <= native_local_port <= 65535 else _get_wsl_native_internal_port(eff_port, http_port)
    return eff_port, eff_local, eff_ip


def _native_bridge_script_lines(
    needs_portproxy: bool,
    eff_port: int,
    internal_port: int,
    eff_ip: str,
    rule_name: str,
    quiet: bool = False,
) -> list[str]:
    suffix = " | Out-Null;" if quiet else ""
    parts: list[str] = []
    if needs_portproxy:
        if quiet:
            parts.append("Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue;")
        parts.extend([
            "Start-Service iphlpsvc -ErrorAction SilentlyContinue" + (";" if quiet else ""),
            f"netsh interface portproxy delete v4tov4 listenport={eff_port} listenaddress=0.0.0.0{suffix}",
        ])
        if eff_ip:
            parts.append(f"netsh interface portproxy delete v4tov4 listenport={eff_port} listenaddress={eff_ip}{suffix}")
        parts.append(f"netsh interface portproxy delete v4tov4 listenport={internal_port} listenaddress=0.0.0.0{suffix}")
        if eff_ip:
            parts.append(f"netsh interface portproxy delete v4tov4 listenport={internal_port} listenaddress={eff_ip}{suffix}")
        parts.append(
            f"netsh interface portproxy add v4tov4 listenport={eff_port} listenaddress=0.0.0.0 connectport={internal_port} connectaddress=127.0.0.1{suffix}"
        )
    parts.extend([
        f'netsh advfirewall firewall delete rule name="{rule_name}"{suffix}',
        f'netsh advfirewall firewall add rule name="{rule_name}" dir=in action=allow protocol=TCP localport={eff_port} profile=any{suffix}',
    ])
    return parts


def get_native_remote_bridge_status(
    http_port: int,
    public_port: int | None = None,
    wifi_ip: str = "",
    native_enabled: bool = False,
    native_local_port: int | None = None,
) -> dict:
    """Inspects Windows portproxy/firewall readiness for Android Remote in WSL2 or native Windows."""
    is_wsl = is_wsl_environment()
    is_windows = os.name == "nt"
    eff_port, internal_port, eff_ip = _validated_bridge_target(http_port, public_port, wifi_ip, native_local_port)
    foh_bridge_port = _get_wsl_remote_bridge_port(http_port) if is_wsl else http_port
    linux_ips = _get_linux_internal_ips() if is_wsl else []
    wsl_ip = linux_ips[0] if linux_ips else ""

    if not is_wsl and not is_windows:
        return {
            "mode": "native_posix",
            "is_wsl": False,
            "is_windows": False,
            "needs_portproxy": False,
            "needs_firewall": False,
            "bridge_active": True,
            "has_portproxy": False,
            "firewall_active": True,
            "port_conflict": eff_port == http_port,
            "foh_bridge_port": foh_bridge_port,
            "wifi_ip": eff_ip,
            "public_port": eff_port,
            "internal_port": eff_port,
            "tls_reachable": None,
            "powershell_admin_cmd": "",
        }

    needs_portproxy = bool(is_wsl and (not eff_ip or eff_ip not in linux_ips))
    rule_name = f"Swararia Android Remote {eff_port}"
    port_conflict = eff_port == http_port or (is_wsl and eff_port == foh_bridge_port)

    has_portproxy = True
    if needs_portproxy:
        valid_targets = {("127.0.0.1", internal_port)}
        if wsl_ip:
            valid_targets.add((wsl_ip, eff_port))
            valid_targets.add((wsl_ip, internal_port))
        has_portproxy = any(
            lp == eff_port and la in ("0.0.0.0", "*", eff_ip) and (ca, cp) in valid_targets
            for (la, lp, ca, cp) in _list_windows_portproxy_rules()
        )

    firewall_active = _check_windows_firewall_rule(rule_name)
    tls_reachable = None
    if native_enabled and eff_ip and not port_conflict and _find_windows_sys32_bin("curl.exe"):
        tls_reachable = _verify_windows_tls_reachable(eff_ip, eff_port)

    cmd_parts = _native_bridge_script_lines(
        needs_portproxy, eff_port, internal_port, eff_ip, rule_name, quiet=False
    )

    bridge_active = (
        not port_conflict
        and has_portproxy
        and firewall_active
        and (tls_reachable is True if tls_reachable is not None else True)
    )
    return {
        "mode": "wsl2_nat" if needs_portproxy else ("wsl2_mirrored" if is_wsl else "windows_native"),
        "is_wsl": is_wsl,
        "is_windows": is_windows,
        "needs_portproxy": needs_portproxy,
        "needs_firewall": True,
        "bridge_active": bridge_active,
        "has_portproxy": has_portproxy,
        "firewall_active": firewall_active,
        "port_conflict": port_conflict,
        "foh_bridge_port": foh_bridge_port,
        "wifi_ip": eff_ip,
        "wsl_ip": wsl_ip,
        "public_port": eff_port,
        "internal_port": internal_port if needs_portproxy else eff_port,
        "tls_reachable": tls_reachable,
        "powershell_admin_cmd": "; ".join(cmd_parts),
    }


def enable_native_remote_bridge(
    http_port: int,
    public_port: int | None = None,
    wifi_ip: str = "",
    native_enabled: bool = False,
    native_local_port: int | None = None,
) -> tuple[bool, str, dict]:
    """Prompts Windows UAC (explicit user action only) to enable Android Remote portproxy & firewall."""
    status = get_native_remote_bridge_status(
        http_port,
        public_port=public_port,
        wifi_ip=wifi_ip,
        native_enabled=native_enabled,
        native_local_port=native_local_port,
    )
    if not status.get("is_wsl") and not status.get("is_windows"):
        return True, "Tidak memerlukan bridge Windows.", status
    if status.get("port_conflict"):
        return False, f"Port {status['public_port']} dipakai UI / FOH Remote WSL. Gunakan port {_get_native_remote_default_port(http_port)}.", status

    eff_port = status["public_port"]
    internal_port = status["internal_port"]
    eff_ip = status.get("wifi_ip") or ""
    rule_name = f"Swararia Android Remote {eff_port}"

    inner_lines = _native_bridge_script_lines(
        bool(status.get("needs_portproxy")), eff_port, internal_port, eff_ip, rule_name, quiet=True
    )

    ok_ps, err = _run_elevated_windows_powershell(inner_lines, timeout=35.0)
    if not ok_ps:
        return False, f"Gagal menjalankan PowerShell UAC: {err}", status

    updated = get_native_remote_bridge_status(
        http_port,
        public_port=eff_port,
        wifi_ip=eff_ip,
        native_enabled=native_enabled,
        native_local_port=native_local_port,
    )
    if updated.get("bridge_active"):
        if native_enabled and updated.get("tls_reachable"):
            return True, f"Bridge/Firewall Android Remote {eff_port} aktif & TLS terverifikasi!", updated
        return True, f"Aturan Bridge/Firewall Windows untuk port {eff_port} aktif. Klik 'Hubungkan Android' jika belum aktif.", updated
    return (
        False,
        "Bridge/Firewall belum aktif (Pastikan klik 'Yes' pada jendela konfirmasi Admin Windows dan 'Hubungkan Android' sudah aktif).",
        updated,
    )


def disable_native_remote_bridge(
    http_port: int,
    public_port: int | None = None,
    wifi_ip: str = "",
    native_enabled: bool = False,
    native_local_port: int | None = None,
) -> tuple[bool, str, dict]:
    """Removes the Windows portproxy and firewall rule for Android Remote without disturbing FOH Remote."""
    status = get_native_remote_bridge_status(
        http_port,
        public_port=public_port,
        wifi_ip=wifi_ip,
        native_enabled=native_enabled,
        native_local_port=native_local_port,
    )
    if not status.get("is_wsl") and not status.get("is_windows"):
        return True, "Bukan lingkungan Windows/WSL2.", status
    if status.get("port_conflict"):
        return False, f"Port {status['public_port']} dipakai FOH Remote / UI sehingga tidak dihapus dari panel ini.", status

    eff_port = status["public_port"]
    eff_ip = status.get("wifi_ip") or ""
    rule_name = f"Swararia Android Remote {eff_port}"
    inner_lines = [
        f'netsh advfirewall firewall delete rule name="{rule_name}" | Out-Null;',
    ]
    if status.get("needs_portproxy"):
        inner_lines.insert(0, f"netsh interface portproxy delete v4tov4 listenport={eff_port} listenaddress=0.0.0.0 | Out-Null;")
        if eff_ip:
            inner_lines.insert(1, f"netsh interface portproxy delete v4tov4 listenport={eff_port} listenaddress={eff_ip} | Out-Null;")

    ok_ps, err = _run_elevated_windows_powershell(inner_lines, timeout=30.0)
    if not ok_ps:
        return False, f"Gagal menghapus aturan Windows: {err}", status

    updated = get_native_remote_bridge_status(
        http_port,
        public_port=eff_port,
        wifi_ip=eff_ip,
        native_enabled=native_enabled,
        native_local_port=native_local_port,
    )
    return True, f"Aturan Bridge/Firewall Android Remote port {eff_port} telah dihapus.", updated


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

COALESCING_REMOTE_ACTIONS = {
    "set_volume",
    "set_preamp",
    "set_eq",
    "seek_ratio",
    "set_autotrim",
    "set_routing",
    "set_play_mode",
}


def _parse_client_device_label(user_agent: str, client_ip: str) -> str:
    """Extracts a safe, human-readable device & browser label from User-Agent."""
    ua = (user_agent or "").strip()
    ua_low = ua.lower()

    if "iphone" in ua_low:
        os_name = "iPhone (iOS)"
    elif "ipad" in ua_low:
        os_name = "iPad (iPadOS)"
    elif "android" in ua_low:
        model_match = re.search(
            r"android\s+[\d.]+;\s*([a-zA-Z0-9 _\-]{2,24}?)(?:\s+build/|\))",
            ua,
            flags=re.IGNORECASE,
        )
        model_str = model_match.group(1).strip() if model_match else ""
        if model_str and model_str.upper() != "K":
            os_name = f"Android ({model_str})"
        else:
            os_name = "Android"
    elif "macintosh" in ua_low or "mac os" in ua_low:
        os_name = "Mac"
    elif "windows" in ua_low:
        os_name = "Windows"
    elif "linux" in ua_low:
        os_name = "Linux"
    else:
        os_name = "Mobile"

    if "edg/" in ua_low or "edga/" in ua_low or "edgios/" in ua_low:
        browser = "Edge"
    elif "opr/" in ua_low or "opera" in ua_low:
        browser = "Opera"
    elif "samsungbrowser" in ua_low:
        browser = "Samsung"
    elif "crios/" in ua_low or ("chrome/" in ua_low and "chromium" not in ua_low):
        browser = "Chrome"
    elif "fxios/" in ua_low or "firefox/" in ua_low:
        browser = "Firefox"
    elif "safari/" in ua_low and "chrome/" not in ua_low:
        browser = "Safari"
    else:
        browser = "Browser"

    if client_ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1") and os_name in (
        "Windows",
        "Linux",
        "Mac",
        "Mobile",
    ):
        return f"Local Sim • {browser}"
    return f"{os_name} • {browser}"


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
        self.remote_clients: dict[str, dict] = {}
        self.blocked_clients: dict[str, dict] = {}
        self.client_roles: dict[str, str] = {}

    def _prune_clients_unlocked(self, now: float) -> None:
        stale = [
            cid
            for cid, info in self.remote_clients.items()
            if (now - float(info.get("last_seen", 0.0) if isinstance(info, dict) else info)) > 12.0
        ]
        for cid in stale:
            self.remote_clients.pop(cid, None)

    def _touch_client_unlocked(
        self,
        client_id: str,
        client_ip: str,
        client_tag: str,
        user_agent: str,
        now: float,
        inc_cmd: bool = False,
    ) -> dict:
        existing = self.remote_clients.get(client_id)
        if not isinstance(existing, dict):
            existing = {
                "client_id": client_id,
                "ip": client_ip or client_id.split(":", 1)[0],
                "tag": client_tag or "mobile",
                "label": _parse_client_device_label(user_agent, client_ip),
                "first_seen": now,
                "last_seen": now,
                "commands_sent": 0,
            }
            self.remote_clients[client_id] = existing
        else:
            existing["last_seen"] = now
            if user_agent and existing.get("label", "").startswith("HP Remote"):
                existing["label"] = _parse_client_device_label(user_agent, client_ip)
        if inc_cmd:
            existing["commands_sent"] = int(existing.get("commands_sent", 0)) + 1
        return existing

    def _get_clients_lists_unlocked(self, now: float) -> tuple[list[dict], list[dict]]:
        self._prune_clients_unlocked(now)
        active_list: list[dict] = []
        for cid, raw_info in self.remote_clients.items():
            if isinstance(raw_info, dict):
                ip = str(raw_info.get("ip") or cid.split(":", 1)[0])
                tag = str(raw_info.get("tag") or "")
                label = str(raw_info.get("label") or "HP Remote")
                first_seen = float(raw_info.get("first_seen") or now)
                last_seen = float(raw_info.get("last_seen") or now)
                cmds = int(raw_info.get("commands_sent") or 0)
            else:
                ip = cid.split(":", 1)[0]
                tag = cid.split(":", 1)[1] if ":" in cid else "mobile"
                label = "HP Remote"
                first_seen = float(raw_info)
                last_seen = float(raw_info)
                cmds = 0
            active_list.append({
                "client_id": cid,
                "ip": ip,
                "tag": tag,
                "label": label,
                "role": self.client_roles.get(cid, "control"),
                "last_seen_ago": round(max(0.0, now - last_seen), 1),
                "connected_sec": int(max(0.0, now - first_seen)),
                "commands_sent": cmds,
            })
        active_list.sort(key=lambda x: x["connected_sec"], reverse=True)

        blocked_list: list[dict] = []
        for cid, binfo in self.blocked_clients.items():
            blocked_list.append({
                "client_id": cid,
                "ip": str(binfo.get("ip") or cid.split(":", 1)[0]),
                "label": str(binfo.get("label") or "HP Remote"),
                "blocked_ago": int(max(0.0, now - float(binfo.get("blocked_at") or now))),
            })
        return active_list, blocked_list

    def get_clients_lists(self) -> tuple[list[dict], list[dict]]:
        now = time.time()
        with self.lock:
            return self._get_clients_lists_unlocked(now)

    def is_client_blocked(self, client_id: str) -> bool:
        with self.lock:
            return client_id in self.blocked_clients

    def get_client_role(self, client_id: str) -> str:
        with self.lock:
            return self.client_roles.get(client_id, "control")

    def kick_client(self, client_id: str) -> bool:
        clean_id = str(client_id or "").strip()
        if not clean_id:
            return False
        now = time.time()
        with self.lock:
            info = self.remote_clients.pop(clean_id, None)
            ip = clean_id.split(":", 1)[0]
            label = "HP Remote"
            if isinstance(info, dict):
                ip = str(info.get("ip") or ip)
                label = str(info.get("label") or label)
            self.blocked_clients[clean_id] = {
                "client_id": clean_id,
                "ip": ip,
                "label": label,
                "blocked_at": now,
            }
            self.command_queue = [c for c in self.command_queue if c.get("client_id") != clean_id]
            return True

    def kick_all_clients(self) -> int:
        now = time.time()
        with self.lock:
            count = len(self.remote_clients)
            for cid, info in list(self.remote_clients.items()):
                ip = cid.split(":", 1)[0]
                label = "HP Remote"
                if isinstance(info, dict):
                    ip = str(info.get("ip") or ip)
                    label = str(info.get("label") or label)
                self.blocked_clients[cid] = {
                    "client_id": cid,
                    "ip": ip,
                    "label": label,
                    "blocked_at": now,
                }
            self.remote_clients.clear()
            self.command_queue = [c for c in self.command_queue if c.get("native_id")]
            return count

    def unblock_client(self, client_id: str) -> bool:
        clean_id = str(client_id or "").strip()
        if not clean_id:
            return False
        with self.lock:
            return self.blocked_clients.pop(clean_id, None) is not None

    def set_client_role(self, client_id: str, role: str) -> str:
        clean_id = str(client_id or "").strip()
        new_role = "view_only" if str(role or "").strip().lower() == "view_only" else "control"
        if clean_id:
            with self.lock:
                self.client_roles[clean_id] = new_role
        return new_role

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
            self.blocked_clients.clear()
            self.command_queue = [c for c in self.command_queue if c.get("native_id")]
            return self.pin

    def set_enabled(self, flag: bool) -> bool:
        with self.lock:
            self.enabled = bool(flag)
            if not self.enabled:
                self.command_queue = [c for c in self.command_queue if c.get("native_id")]
                self.remote_clients.clear()
            return self.enabled

    def get_active_remotes_count(self) -> int:
        now = time.time()
        with self.lock:
            self._prune_clients_unlocked(now)
            return len(self.remote_clients)

    def update_master_state(self, state_payload: dict | None, include_native: bool = True) -> tuple[list[dict], int, str, bool]:
        now = time.time()
        with self.lock:
            if isinstance(state_payload, dict) and state_payload:
                self.master_state = state_payload
                self.master_updated_at = now
            self._prune_clients_unlocked(now)
            pending = [c for c in self.command_queue if include_native or not c.get("native_id")]
            self.command_queue = [c for c in self.command_queue if not include_native and c.get("native_id")]
            return pending, len(self.remote_clients), self.pin, self.enabled

    def get_remote_state(
        self,
        client_id: str,
        client_ip: str = "",
        client_tag: str = "",
        user_agent: str = "",
    ) -> dict:
        now = time.time()
        with self.lock:
            self._touch_client_unlocked(client_id, client_ip, client_tag, user_agent, now, inc_cmd=False)
            self._prune_clients_unlocked(now)
            return {
                "ok": True,
                "enabled": self.enabled,
                "role": self.client_roles.get(client_id, "control"),
                "master_online": (now - self.master_updated_at) < 5.0,
                "master_updated_at": self.master_updated_at,
                "active_remotes_count": len(self.remote_clients),
                "state": self.master_state,
            }

    def enqueue_command(
        self,
        action: str,
        params: dict | None,
        client_id: str,
        client_ip: str = "",
        client_tag: str = "",
        user_agent: str = "",
    ) -> dict:
        now = time.time()
        safe_params = params if isinstance(params, dict) else {}
        with self.lock:
            self._touch_client_unlocked(client_id, client_ip, client_tag, user_agent, now, inc_cmd=True)
            self._prune_clients_unlocked(now)

            if action in COALESCING_REMOTE_ACTIONS:
                for existing in reversed(self.command_queue):
                    if existing["action"] == action:
                        if action == "set_eq":
                            existing["params"].update(safe_params)
                        else:
                            existing["params"] = safe_params
                        existing["created_at"] = now
                        existing["client_id"] = client_id
                        return existing

            cmd = {
                "id": self.next_cmd_id,
                "action": action,
                "params": safe_params,
                "client_id": client_id,
                "created_at": now,
            }
            self.next_cmd_id += 1
            self.command_queue.append(cmd)
            if len(self.command_queue) > 50:
                self.command_queue = self.command_queue[-50:]
            return cmd


remote_hub = RemotePlayerHub()

from secure_remote import SecureRemote, RemoteError


class LocalAudioServer(ThreadingHTTPServer):
    """Own both listeners, so either launcher has the same shutdown boundary."""
    daemon_threads = True

    def __init__(self, address, handler):
        self.secure_remote = SecureRemote(remote_hub)
        self._wsl_foh_bridge_server = None
        self._wsl_foh_bridge_thread = None
        self.wsl_foh_internal_port: int | None = None
        super().__init__(address, handler)
        if is_wsl_environment() and address and str(address[0]) == "0.0.0.0":
            self._start_wsl_foh_bridge()

    def _start_wsl_foh_bridge(self) -> None:
        primary_port = int(self.server_address[1])
        preferred_port = _get_wsl_foh_internal_port(primary_port)
        bridge_srv = None
        for candidate_port in (preferred_port, 0):
            try:
                bridge_srv = _FohBridgeServer(
                    ("127.0.0.1", candidate_port),
                    _FohBridgedHandler,
                    parent_server=self,
                )
                break
            except OSError:
                continue
        if bridge_srv is None:
            return
        actual_internal = int(bridge_srv.server_address[1])
        self._wsl_foh_bridge_server = bridge_srv
        self.wsl_foh_internal_port = actual_internal
        with _wsl_foh_ports_lock:
            _active_wsl_foh_ports[primary_port] = actual_internal
        started = threading.Event()

        def _serve() -> None:
            started.set()
            bridge_srv.serve_forever()

        thread = threading.Thread(target=_serve, daemon=True)
        self._wsl_foh_bridge_thread = thread
        thread.start()
        started.wait(timeout=1.0)

    def _stop_wsl_foh_bridge(self) -> None:
        bridge_srv = self._wsl_foh_bridge_server
        bridge_thread = self._wsl_foh_bridge_thread
        internal_port = self.wsl_foh_internal_port
        self._wsl_foh_bridge_server = None
        self._wsl_foh_bridge_thread = None
        self.wsl_foh_internal_port = None
        try:
            primary_port = int(self.server_address[1])
            with _wsl_foh_ports_lock:
                if internal_port is not None and _active_wsl_foh_ports.get(primary_port) == internal_port:
                    _active_wsl_foh_ports.pop(primary_port, None)
        except Exception:
            pass
        if bridge_srv is not None:
            try:
                bridge_srv.shutdown()
            except Exception:
                pass
            try:
                bridge_srv.server_close()
            except Exception:
                pass
        if bridge_thread is not None and bridge_thread.is_alive():
            bridge_thread.join(timeout=2.0)

    def server_close(self):
        self._stop_wsl_foh_bridge()
        self.secure_remote.stop()
        super().server_close()


class AudioServerHandler(BaseHTTPRequestHandler):
    """Secure HTTP Request Handler with FOH Mobile Remote LAN Gate."""

    protocol_version = "HTTP/1.1"
    timeout = 60.0

    def is_localhost_client(self) -> bool:
        # Never authorize from Host, X-Forwarded-For or client-provided tags.
        return str(self.client_address[0]) in ('127.0.0.1', '::1', '::ffff:127.0.0.1')

    def local_request_allowed(self, write=False):
        if not self.is_localhost_client():
            return False
        port = self.server.server_address[1]
        host = self.headers.get('Host', '')
        if len(self.headers.get_all('Host', [])) != 1:
            return False
        try:
            parsed_host = urlparse(f'http://{host}')
            host_port = parsed_host.port
        except ValueError:
            return False
        if (parsed_host.username or parsed_host.password or parsed_host.path
                or parsed_host.query or parsed_host.fragment or '@' in host):
            return False
        host_name = (parsed_host.hostname or '').strip().lower()
        if host_name not in ('127.0.0.1', 'localhost', '::1'):
            return False
        if host_port is not None and host_port != port:
            return False
        if host_port is None and port != 80:
            return False
        origin = self.headers.get('Origin')
        if len(self.headers.get_all('Origin', [])) > 1 or (write and not origin):
            return False
        if origin:
            parsed = urlparse(origin)
            orig_host = (parsed.hostname or '').strip().lower()
            if orig_host not in ('127.0.0.1', 'localhost', '::1'):
                return False
            if parsed.port is not None and parsed.port != port:
                return False
        if self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
            return False
        return True

    def _build_native_admin_status(self, force_refresh: bool = False) -> dict:
        remote = self.server.secure_remote
        status = remote.admin_status()
        http_port = int(self.server.server_address[1])
        is_wsl = is_wsl_environment()
        lan_ips = [ip for ip in get_local_lan_ips(force_refresh=force_refresh) if _is_rfc1918_ipv4(ip)]
        linux_ips = _get_linux_internal_ips() if is_wsl else []
        status['lan_ips'] = lan_ips
        if lan_ips:
            status['default_bind_ip'] = lan_ips[0]
        status['default_port'] = _get_native_remote_default_port(http_port)
        status['is_wsl'] = is_wsl
        status['is_wsl_nat'] = bool(is_wsl and (not lan_ips or lan_ips[0] not in linux_ips))
        status['is_windows'] = (os.name == 'nt')
        if is_wsl:
            status['foh_bridge_port'] = _get_wsl_remote_bridge_port(http_port)
        return status

    def _resolve_native_bridge_target(self, payload: dict | None = None) -> tuple[int, int | None, str, bool, int | None]:
        http_port = int(self.server.server_address[1])
        remote = self.server.secure_remote
        with remote.lock:
            enabled = bool(remote.enabled)
            conn_url = remote.connection_info.get('url', '') if enabled else ''
            bind_port = remote.bind_info.get('port') if enabled else None
        if enabled and conn_url:
            parsed = urlparse(conn_url)
            return http_port, parsed.port, (parsed.hostname or ''), True, bind_port
        req_ip = ''
        req_port = None
        if isinstance(payload, dict):
            cand_ip = payload.get('bind_ip')
            if isinstance(cand_ip, str) and _is_rfc1918_ipv4(cand_ip):
                req_ip = cand_ip.strip()
            cand_port = payload.get('port')
            if type(cand_port) is int and 1 <= cand_port <= 65535:
                req_port = cand_port
        return http_port, req_port, req_ip, False, None

    def parse_request(self):
        valid = super().parse_request()
        if valid and self.is_localhost_client() and not self.local_request_allowed():
            self.close_connection = True
            self.send_json(403, {'code': 'local_origin_required'})
            return False
        return valid

    def native_admin(self, payload):
        remote = self.server.secure_remote
        try:
            op = payload.get('action')
            fields = {'start': {'action', 'bind_ip', 'port'}, 'stop': {'action'},
                      'invite_open': {'action'}, 'invite_close': {'action'},
                      'approve': {'action', 'device_id', 'role'},
                      'revoke': {'action', 'device_id'}, 'deny': {'action', 'device_id'}}
            if not isinstance(op, str) or op not in fields or set(payload) - fields[op]:
                raise RemoteError('invalid_admin_action', 400)
            if op == 'start':
                bind_ip = payload.get('bind_ip')
                http_port = int(self.server.server_address[1])
                port = payload.get('port', _get_native_remote_default_port(http_port))
                from secure_remote_tls import validate_bind
                validate_bind(bind_ip, port)
                is_wsl = is_wsl_environment()
                linux_ips = set(_get_linux_internal_ips()) if is_wsl else set()
                if is_wsl and not ipaddress.IPv4Address(bind_ip).is_loopback and bind_ip not in linux_ips:
                    reachable_ips = {ip for ip in get_local_lan_ips(force_refresh=False) if _is_rfc1918_ipv4(ip)}
                    if bind_ip not in reachable_ips:
                        reachable_ips = {ip for ip in get_local_lan_ips(force_refresh=True) if _is_rfc1918_ipv4(ip)}
                    if bind_ip in reachable_ips:
                        if port in (http_port, _get_wsl_remote_bridge_port(http_port)):
                            raise RemoteError('wsl_port_reserved', 409)
                        internal_port = _get_wsl_native_internal_port(port, http_port)
                        remote.start('127.0.0.1', internal_port, advertise_ip=bind_ip, advertise_port=port)
                    else:
                        remote.start(bind_ip, port)
                else:
                    remote.start(bind_ip, port)
            elif op == 'stop':
                remote.stop()
            elif op == 'invite_open':
                remote.open_invite()
            elif op == 'invite_close':
                remote.close_invite()
            elif op == 'approve':
                remote.approve(payload.get('device_id'), payload.get('role'))
            elif op in ('deny', 'revoke'):
                remote.revoke(payload.get('device_id'), deny=op == 'deny')
            self.send_json(200, self._build_native_admin_status(force_refresh=False))
        except RemoteError as exc:
            self.send_json(exc.status, {'code': exc.code})
        except (ValueError, TypeError):
            self.send_json(400, {'code': 'invalid_request'})

    def log_error(self, format, *args):
        # In HTTP/1.1, persistent keep-alive client sockets naturally close when idle.
        # Suppress benign socket timeout log so it does not pollute the server console.
        msg = format % args
        if "Request timed out" in msg:
            return
        self.log_message(format, *args)

    def log_message(self, format, *args):
        # Request lines and parser errors may contain credentials supplied by
        # clients, including rejected query strings. Do not log their contents.
        return

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
            "img-src 'self' data: https://*.googleusercontent.com https://*.ytimg.com https://*.ggpht.com; "
            "media-src 'self' blob:; "
            "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com; "
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
                self.send_header("Content-Length", "0")
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

        if path == '/api/native-remote':
            if not self.local_request_allowed():
                self.send_json(403, {'code': 'local_origin_required'})
            elif self.path != path:
                self.send_json(404, {'code': 'unknown_route'})
            else:
                self.send_json(200, self._build_native_admin_status(force_refresh=False))
            return

        if path == '/api/native-remote/wsl-bridge':
            if not self.local_request_allowed():
                self.send_json(403, {'code': 'local_origin_required'})
            elif self.path != path:
                self.send_json(404, {'code': 'unknown_route'})
            else:
                http_port, eff_port, eff_ip, enabled, bind_port = self._resolve_native_bridge_target()
                self.send_json(200, get_native_remote_bridge_status(
                    http_port,
                    public_port=eff_port,
                    wifi_ip=eff_ip,
                    native_enabled=enabled,
                    native_local_port=bind_port,
                ))
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
        elif path == "/api/check-update":
            self.send_json(200, check_for_updates())
        elif path == "/api/undo-rename":
            self.send_json(200, {"ok": True, "last": fs_browser.peek_rename_history()})
        elif path == "/api/remote/info":
            qs = parse_qs(parsed.query)
            force_ip = qs.get("refresh", ["0"])[0] == "1"
            interfaces = get_network_interfaces_detail(force_refresh=force_ip)
            lan_ips = get_local_lan_ips(force_refresh=False)
            actual_port = int(self.server.server_address[1])
            remote_port = _get_wsl_remote_bridge_port(actual_port)
            active_list, blocked_list = remote_hub.get_clients_lists()
            info: dict = {
                "ok": True,
                "is_localhost": is_local,
                "enabled": remote_hub.enabled,
                "port": remote_port,
                "lan_ips": lan_ips,
                "master_online": (time.time() - remote_hub.master_updated_at) < 5.0,
                "active_remotes_count": len(active_list),
            }
            if is_local:
                info["pin"] = remote_hub.pin
                info["active_remotes"] = active_list
                info["blocked_remotes"] = blocked_list
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
            client_ip = str(self.client_address[0])
            raw_tag = (self.headers.get("X-FOH-Client-ID") or "mobile").strip()
            client_tag = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_tag)[:32] or "mobile"
            client_id = f"{client_ip}:{client_tag}"
            if remote_hub.is_client_blocked(client_id):
                self.send_json(403, {
                    "ok": False,
                    "error": "Koneksi HP ini telah diputus oleh operator Master Deck.",
                    "code": "KICKED",
                })
                return
            ua = self.headers.get("User-Agent") or ""
            self.send_json(200, remote_hub.get_remote_state(client_id, client_ip, client_tag, ua))
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
        elif path == "/api/stream-preview":
            qs = parse_qs(parsed.query)
            target_url = qs.get("url", [None])[0]
            if not target_url:
                self.send_json(400, {"error": "Parameter url diperlukan."})
                return
            cookies = COOKIES_FILE if COOKIES_FILE.is_file() else None
            stream_info = audio_manager.get_preview_stream_info(target_url, cookies_file=cookies)
            if not stream_info:
                self.send_json(404, {"error": "Stream audio pratinjau tidak ditemukan atau gagal diekstrak."})
                return
            direct_url, headers = stream_info
            self.serve_proxied_audio_stream(direct_url, headers)
        elif path == "/api/playlist/inspect":
            qs = parse_qs(parsed.query)
            target_url = qs.get("url", [None])[0]
            if not target_url:
                self.send_json(400, {"ok": False, "error": "Parameter url diperlukan."})
                return
            try:
                limit = min(max(int(qs.get("limit", [100])[0]), 1), 300)
            except Exception:
                limit = 100
            use_cookies = qs.get("use_cookies", ["1"])[0] != "0"
            cookies = COOKIES_FILE if use_cookies and COOKIES_FILE.is_file() else None
            try:
                data = audio_manager.inspect_playlist(target_url, limit=limit, cookies_file=cookies)
                if not data:
                    self.send_json(404, {"ok": False, "error": "Tidak dapat memuat daftar lagu dari playlist/album ini."})
                    return
                self.send_json(200, {"ok": True, **data})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": f"Gagal membaca playlist: {str(exc)}"})
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

        self.close_connection = True
        if path.startswith('/api/native-remote') and not self.local_request_allowed(write=True):
            self.send_json(403, {'code': 'local_origin_required'})
            return
        if path.startswith('/api/native-remote') and self.path not in ('/api/native-remote', '/api/native-remote/claim', '/api/native-remote/wsl-bridge'):
            self.send_json(404, {'code': 'unknown_route'})
            return
        if self.headers.get('Content-Type', '').split(';')[0].lower() != 'application/json':
            self.send_json(415, {'code': 'json_required'})
            return
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get_all('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,8}', lengths[0]):
            self.send_json(400, {'code': 'invalid_length'})
            return
        content_length = int(lengths[0])
        if content_length > (65536 if path == '/api/remote/state' else 4096 if path.startswith('/api/native-remote') else 1024 * 1024):
            self.send_json(413, {'code': 'body_too_large'})
            return
        body = self.rfile.read(content_length)
        try:
            payload = json.loads(body.decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError()
        except (ValueError, UnicodeError, RecursionError):
            self.send_json(400, {'code': 'invalid_json'})
            return
        if path == '/api/native-remote/claim':
            if set(payload) != {'command_id', 'master_instance'}:
                self.send_json(400, {'code': 'invalid_fields'})
            else:
                self.send_json(200, self.server.secure_remote.claim(payload['command_id'], payload['master_instance']))
            return
        if path == '/api/native-remote/wsl-bridge':
            op = payload.get('action', 'status')
            if op not in ('status', 'enable', 'disable') or (set(payload) - {'action', 'bind_ip', 'port'}):
                self.send_json(400, {'code': 'invalid_fields'})
                return
            http_port, eff_port, eff_ip, enabled, bind_port = self._resolve_native_bridge_target(payload)
            if op == 'status':
                bridge = get_native_remote_bridge_status(
                    http_port,
                    public_port=eff_port,
                    wifi_ip=eff_ip,
                    native_enabled=enabled,
                    native_local_port=bind_port,
                )
                self.send_json(200, {'ok': True, 'bridge': bridge})
            elif op == 'disable':
                ok_bridge, msg_bridge, bridge = disable_native_remote_bridge(
                    http_port,
                    public_port=eff_port,
                    wifi_ip=eff_ip,
                    native_enabled=enabled,
                    native_local_port=bind_port,
                )
                self.send_json(200 if ok_bridge else 409, {'ok': ok_bridge, 'message': msg_bridge, 'bridge': bridge})
            else:
                ok_bridge, msg_bridge, bridge = enable_native_remote_bridge(
                    http_port,
                    public_port=eff_port,
                    wifi_ip=eff_ip,
                    native_enabled=enabled,
                    native_local_port=bind_port,
                )
                self.send_json(200 if ok_bridge else 409, {'ok': ok_bridge, 'message': msg_bridge, 'bridge': bridge})
            return
        if path == '/api/native-remote':
            self.native_admin(payload)
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
            native_master = 'master_instance' in payload or 'native_acks' in payload
            if native_master and not self.local_request_allowed(write=True):
                self.send_json(403, {'code': 'local_origin_required'})
                return
            if payload.get("regenerate_pin"):
                remote_hub.regenerate_pin()
            if "enabled" in payload and isinstance(payload["enabled"], bool):
                remote_hub.set_enabled(payload["enabled"])
            if native_master:
                try:
                    commands = self.server.secure_remote.master_poll(
                        payload.get('state'), payload.get('native_acks', []),
                        payload.get('master_instance'), catalog=payload.get('native_catalog'),
                    )
                except RemoteError as exc:
                    self.send_json(exc.status, {'code': exc.code})
                    return
                active_count = remote_hub.get_active_remotes_count()
                current_pin, is_enabled = remote_hub.pin, remote_hub.enabled
            else:
                commands, active_count, current_pin, is_enabled = remote_hub.update_master_state(payload.get("state"), include_native=False)
            active_list, blocked_list = remote_hub.get_clients_lists()
            response_body = {
                "ok": True,
                "commands": commands,
                "active_remotes_count": active_count,
                "active_remotes": active_list,
                "blocked_remotes": blocked_list,
                "pin": current_pin,
                "enabled": is_enabled,
                "port": int(self.server.server_address[1]),
            }
            if native_master:
                response_body["native_catalog_synced"] = bool(self.server.secure_remote.tracks_synced)
            self.send_json(200, response_body)
        elif path == "/api/remote/clients":
            if not is_local:
                self.send_json(403, {"error": "Hanya Master Deck lokal yang dapat mengelola koneksi HP."})
                return
            op = str(payload.get("action") or "").strip().lower()
            target_cid = str(payload.get("client_id") or "").strip()
            if op == "kick" and target_cid:
                remote_hub.kick_client(target_cid)
            elif op == "kick_all":
                remote_hub.kick_all_clients()
            elif op == "unblock" and target_cid:
                remote_hub.unblock_client(target_cid)
            elif op == "set_role" and target_cid:
                remote_hub.set_client_role(target_cid, str(payload.get("role") or "control"))
            else:
                self.send_json(400, {"ok": False, "error": "Perintah manajemen perangkat tidak valid."})
                return
            active_list, blocked_list = remote_hub.get_clients_lists()
            self.send_json(200, {
                "ok": True,
                "active_remotes_count": len(active_list),
                "active_remotes": active_list,
                "blocked_remotes": blocked_list,
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
            client_ip = str(self.client_address[0])
            raw_tag = (self.headers.get("X-FOH-Client-ID") or "mobile").strip()
            client_tag = re.sub(r"[^a-zA-Z0-9_\-]", "", raw_tag)[:32] or "mobile"
            client_id = f"{client_ip}:{client_tag}"
            if remote_hub.is_client_blocked(client_id):
                self.send_json(403, {
                    "ok": False,
                    "error": "Koneksi HP ini telah diputus oleh operator Master Deck.",
                    "code": "KICKED",
                })
                return
            if remote_hub.get_client_role(client_id) == "view_only":
                self.send_json(403, {
                    "ok": False,
                    "error": "HP ini diatur ke mode Pantau Saja (View-Only) oleh Master Deck.",
                    "code": "VIEW_ONLY",
                })
                return
            ua = self.headers.get("User-Agent") or ""
            cmd = remote_hub.enqueue_command(action, payload.get("params"), client_id, client_ip, client_tag, ua)
            self.send_json(200, {"ok": True, "command_id": cmd["id"]})
        elif path == "/api/download":
            status, resp = task_manager.enqueue_downloads(payload)
            self.send_json(status, resp)
        elif path == "/api/search":
            self._handle_post_search(payload)
        elif path == "/api/playlist/inspect":
            self._handle_post_playlist_inspect(payload)
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
        elif path == "/api/organize-folders":
            self._handle_post_organize_folders(payload)
        elif path == "/api/undo-rename":
            ok, msg, pairs = fs_browser.undo_last_batch_rename()
            if ok:
                for cur, restored in pairs:
                    metadata_cache.rename_entry(cur, restored)
            self.send_json(200 if ok else 409, {"ok": ok, "message": msg} if ok else {"error": msg})
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
        elif path == "/api/install-update":
            if not is_local:
                self.send_json(403, {"ok": False, "error": "Hanya Master Deck lokal yang dapat memasang pembaruan."})
                return
            download_url = str(payload.get("download_url") or "").strip()
            ok_inst, msg_inst = install_update_package(download_url)
            self.send_json(200 if ok_inst else 400, {
                "ok": ok_inst,
                "message": msg_inst,
            })
        else:
            self.send_error(404, "Endpoint not found")

    def _handle_post_search(self, payload: dict) -> None:
        query = str((payload or {}).get("query") or "").strip()
        if not query:
            self.send_json(400, {"ok": False, "error": "Kata kunci pencarian tidak boleh kosong."})
            return
        search_type = str((payload or {}).get("type") or "songs").strip().lower()
        limit = min(max(int((payload or {}).get("limit") or 15), 1), 50)
        use_cookies = bool((payload or {}).get("use_cookies", True))
        cookies = COOKIES_FILE if use_cookies and COOKIES_FILE.is_file() else None

        try:
            results = audio_manager.search_youtube_music(
                query=query,
                search_type=search_type,
                limit=limit,
                cookies_file=cookies,
            )
            self.send_json(200, {
                "ok": True,
                "query": query,
                "type": search_type,
                "count": len(results),
                "results": results,
            })
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": f"Pencarian gagal: {str(exc)}"})

    def _handle_post_playlist_inspect(self, payload: dict) -> None:
        target_url = (payload or {}).get("url") or (payload or {}).get("playlist_url")
        if not target_url:
            self.send_json(400, {"ok": False, "error": "Parameter url diperlukan."})
            return
        try:
            limit = min(max(int((payload or {}).get("limit") or 100), 1), 300)
        except Exception:
            limit = 100
        use_cookies = bool((payload or {}).get("use_cookies", True))
        cookies = COOKIES_FILE if use_cookies and COOKIES_FILE.is_file() else None
        try:
            data = audio_manager.inspect_playlist(str(target_url).strip(), limit=limit, cookies_file=cookies)
            if not data:
                self.send_json(404, {"ok": False, "error": "Tidak dapat memuat daftar lagu dari playlist/album ini."})
                return
            self.send_json(200, {"ok": True, **data})
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": f"Gagal membaca playlist: {str(exc)}"})

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

    def _handle_post_organize_folders(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_paths = payload.get("rel_paths")
        template = str(payload.get("template") or "artist_album")
        preview_only = bool(payload.get("preview_only", payload.get("preview", False)))
        expected_raw = payload.get("expected_plan")
        expected_plan = (
            {str(k): str(v) for k, v in expected_raw.items()}
            if isinstance(expected_raw, dict) and not preview_only else None
        )
        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, plan = fs_browser.organize_into_folders(
                source_dir=src_dir,
                rel_paths=rel_paths if isinstance(rel_paths, list) else [],
                template=template,
                preview_only=preview_only,
                expected_plan=expected_plan,
            )
            if not ok:
                self.send_json(409 if expected_plan is not None and "changed since the preview" in msg else 400, {"error": msg})
                return
            if not preview_only:
                for item in plan:
                    if item.get("applied"):
                        metadata_cache.rename_entry(item["old_path"], item["new_path"])
            public_plan = [
                {
                    "rel_path": item["rel_path"],
                    "new_rel_path": item["new_rel_path"],
                    "folder": item["folder"],
                    "old_name": item["old_name"],
                    "new_name": item["new_name"],
                    "changed": item["changed"],
                    "reason": item.get("reason", ""),
                }
                for item in plan
            ]
            self.send_json(200, {
                "ok": True,
                "message": msg,
                "preview_only": preview_only,
                "changed_count": sum(1 for i in plan if i.get("changed")),
                "total_count": len(plan),
                "items": public_plan,
            })
        except Exception as exc:
            self.send_json(400, {"error": str(exc)})

    def _handle_post_batch_rename(self, payload: dict) -> None:
        raw_src = payload.get("source_dir")
        rel_paths = payload.get("rel_paths")
        if isinstance(payload.get("options"), dict):
            options = payload["options"]
        else:
            # Frontend sends options flat at the top level.
            option_keys = ("numbering_mode", "start_number", "strip_yt_id", "strip_junk_tags", "clean_spaces", "sort_by")
            options = {k: payload[k] for k in option_keys if k in payload}
        # Accept both "preview_only" and the frontend's "preview" flag.
        preview_only = bool(payload.get("preview_only", payload.get("preview", False)))
        expected_raw = payload.get("expected_plan")
        expected_plan = (
            {str(k): str(v) for k, v in expected_raw.items()}
            if isinstance(expected_raw, dict) and not preview_only else None
        )

        try:
            src_dir = resolve_safe_dir(raw_src, INBOX_DIR, must_exist=True) if raw_src else INBOX_DIR.resolve()
            ok, msg, plan = fs_browser.batch_rename_entries(
                source_dir=src_dir,
                rel_paths=rel_paths if isinstance(rel_paths, list) else [],
                options=options,
                preview_only=preview_only,
                expected_plan=expected_plan,
            )
            if not ok:
                self.send_json(409 if expected_plan is not None and "changed since the preview" in msg else 400, {"error": msg})
                return

            if not preview_only:
                for item in plan:
                    if item.get("changed") and item.get("applied"):
                        metadata_cache.rename_entry(item["old_path"], item["new_path"])

            changed_count = sum(1 for item in plan if item.get("changed"))
            public_plan = [
                {
                    "rel_path": item["rel_path"],
                    "new_rel_path": item["new_rel_path"],
                    "folder": item["folder"],
                    "old_name": item["old_name"],
                    "new_name": item["new_name"],
                    "changed": item["changed"],
                }
                for item in plan
            ]
            self.send_json(200, {
                "ok": True,
                "message": msg,
                "preview_only": preview_only,
                "changed_count": changed_count,
                "total_count": len(plan),
                "plan": public_plan,
                "items": public_plan,
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
                        self.send_header("Content-Length", "0")
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
            self.close_connection = True
            return
        except Exception as exc:
            sys.stderr.write(f"[Stream Error] {exc}\n")

    def serve_proxied_audio_stream(self, direct_url: str, custom_headers: dict | None = None):
        """Proxies an upstream audio stream with HTTP Range forwarding for live web preview."""
        req_headers = dict(custom_headers or {})
        if not req_headers.get("User-Agent"):
            req_headers["User-Agent"] = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
        req_headers["Accept"] = "*/*"

        client_range = self.headers.get("Range")
        if client_range:
            req_headers["Range"] = client_range

        req = urllib.request.Request(direct_url, headers=req_headers)
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                status_code = resp.status
                self.send_response(status_code)
                raw_ct = resp.headers.get("Content-Type") or "audio/webm"
                # Coerce video/* to audio/* so browser <audio> tag with nosniff won't reject audio-only webm
                if raw_ct.startswith("video/webm"):
                    content_type = "audio/webm"
                elif raw_ct.startswith("video/mp4"):
                    content_type = "audio/mp4"
                elif raw_ct.startswith("video/"):
                    content_type = "audio/" + raw_ct.split("video/", 1)[-1]
                else:
                    content_type = raw_ct

                self.send_security_headers(content_type)
                self.send_header("Accept-Ranges", "bytes")

                content_length = resp.headers.get("Content-Length")
                if content_length:
                    self.send_header("Content-Length", content_length)

                content_range = resp.headers.get("Content-Range")
                if content_range:
                    self.send_header("Content-Range", content_range)

                self.end_headers()

                chunk_size = 65536
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        except urllib.error.HTTPError as exc:
            sys.stderr.write(f"[Proxy Stream HTTP Error] {exc.code}: {exc.reason}\n")
            self.send_error(exc.code, f"Upstream error: {exc.reason}")
        except Exception as exc:
            sys.stderr.write(f"[Proxy Stream Error] {exc}\n")
            self.send_error(500, str(exc))

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


class _FohBridgedHandler(AudioServerHandler):
    """Handles WSL2 Windows portproxy -> wslrelay FOH traffic strictly as a non-localhost LAN client."""

    class _ServerProxy:
        __slots__ = ("_inner", "server_address")

        def __init__(self, inner, primary_port: int) -> None:
            self._inner = inner
            self.server_address = ("0.0.0.0", primary_port)

        def __getattr__(self, name: str):
            return getattr(self._inner, name)

    def __init__(self, request, client_address, server):
        proxy = self._ServerProxy(server, int(getattr(server, "primary_port", server.server_address[1])))
        super().__init__(request, client_address, proxy)

    def is_localhost_client(self) -> bool:
        return False


class _FohBridgeServer(ThreadingHTTPServer):
    """Loopback-only WSL2 companion HTTP listener for wslrelay FOH portproxy forwarding."""
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, parent_server: LocalAudioServer):
        self.secure_remote = parent_server.secure_remote
        self.primary_port = int(parent_server.server_address[1])
        super().__init__(address, handler)


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
        server = LocalAudioServer((host, port), AudioServerHandler)
    except OSError:
        try:
            server = LocalAudioServer((host, 0), AudioServerHandler)
        except OSError:
            server = LocalAudioServer(("127.0.0.1", 0), AudioServerHandler)
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
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
