"""Review regressions: all privileged boundaries mocked; no LAN binds."""
import base64
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_native_removal_rejects_residual_profile_subset_at_subprocess_boundary():
    import json
    import web_ui as web
    residual = dict(enabled=True, inbound=True, allow=True, all_profiles=False,
                    name='Swararia Android Remote 8767', protocol='TCP', local_port='8767')
    with patch.object(web, 'is_wsl_environment', return_value=True), \
            patch.object(web, '_active_wsl_foh_ports', {}), \
            patch.object(web, '_get_linux_internal_ips', return_value=['192.168.1.2']), \
            patch.object(web, 'get_local_lan_ips', return_value=['192.168.1.2']), \
            patch.object(web, '_find_windows_sys32_bin', side_effect=lambda name: '/fake/powershell.exe' if name == 'powershell.exe' else None), \
            patch.object(web.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps([residual]))) as run:
        ok, message, status = web.disable_native_remote_bridge(8765, 8767, '192.168.1.2')
        assert ok is False, 'A residual profile-subset rule is not proof of deletion'
        assert 'telah dihapus' not in message
        assert status['firewall_active'] is False and status['firewall_present'] is True
        assert run.call_count == 3  # initial read, elevated deletion, final read


def test_elevated_deletes_skip_only_proven_absence_and_check_real_failures():
    import web_ui as web
    lines = ['netsh interface portproxy delete v4tov4 listenport=8767 listenaddress=0.0.0.0 | Out-Null;',
             'netsh advfirewall firewall delete rule name="Swararia Android Remote 8767" | Out-Null;',
             'netsh interface portproxy add v4tov4 listenport=8767 listenaddress=0.0.0.0 connectport=8768 connectaddress=127.0.0.1 | Out-Null;']
    with patch.object(web, '_find_windows_sys32_bin', return_value='/fake/powershell.exe'), \
            patch.object(web.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
        assert web._run_elevated_windows_powershell(lines) == (True, '')
        outer = base64.b64decode(run.call_args[0][0][-1]).decode('utf-16le')
        inner = base64.b64decode(re.search("EncodedCommand','([^']+)'", outer)[1]).decode('utf-16le')
        assert 'netsh interface portproxy show v4tov4' in inner
        assert 'Get-NetFirewallRule' in inner and 'PersistentStore' in inner
        assert 'if ($existing.Count -gt 0)' in inner
        assert inner.count('$LASTEXITCODE') == 4


def test_elevation_forwards_child_failure_and_sanitizes_errors():
    import web_ui as web
    for result in [SimpleNamespace(returncode=1, stderr='secret'), OSError('secret')]:
        with patch.object(web, '_find_windows_sys32_bin', return_value='/fake/powershell.exe'), \
                patch.object(web.subprocess, 'run', **({'side_effect': result} if isinstance(result, Exception) else {'return_value': result})) as run:
            ok, error = web._run_elevated_windows_powershell(['netsh first | Out-Null;', 'netsh second | Out-Null;'])
            assert not ok and error and 'secret' not in error
            outer = base64.b64decode(run.call_args[0][0][-1]).decode('utf-16le')
            assert '-PassThru' in outer and '-Wait' in outer and '.ExitCode' in outer
            inner = base64.b64decode(re.search("EncodedCommand','([^']+)'", outer)[1]).decode('utf-16le')
            assert inner.count('$LASTEXITCODE') == 2
            assert 'exit 0' in inner and 'catch' in inner


def test_native_removal_checks_partial_failure_and_postconditions():
    import web_ui as web
    initial = dict(is_wsl=True, is_windows=False, public_port=8767, internal_port=8768,
                   wifi_ip='192.168.1.2', needs_portproxy=True, port_conflict=False,
                   bridge_active=True, has_portproxy=True, portproxy_present=True,
                   firewall_active=True, firewall_present=True)
    # Readiness is not presence: disabled/unsuitable rules and wrong-target
    # proxies must still block a successful removal, as must unknown reads.
    for success, final in [(False, initial), (True, initial),
                           (True, dict(initial, bridge_active=False, has_portproxy=False)),
                           (True, dict(initial, bridge_active=False, firewall_active=False)),
                           (True, dict(initial, bridge_active=False, has_portproxy=False, firewall_active=None)),
                           (True, dict(initial, bridge_active=False, has_portproxy=False, portproxy_present=False, firewall_active=False)),
                           (True, dict(initial, bridge_active=False, has_portproxy=False, firewall_active=False, firewall_present=False)),
                           (True, dict(initial, bridge_active=False, has_portproxy=False, portproxy_present=None, firewall_present=False)),
                           (True, dict(initial, bridge_active=False, portproxy_present=False, firewall_present=None)),
                           (False, dict(initial, bridge_active=False, has_portproxy=False, portproxy_present=False, firewall_active=False, firewall_present=False))]:
        with patch.object(web, 'get_native_remote_bridge_status', side_effect=[initial, final]) as status, \
                patch.object(web, '_run_elevated_windows_powershell', return_value=(success, 'failed')):
            ok, msg, updated = web.disable_native_remote_bridge(8765)
            assert ok is False and 'telah dihapus' not in msg
            assert updated == final and status.call_count == 2
    final = dict(initial, bridge_active=False, has_portproxy=False, portproxy_present=False,
                 firewall_active=False, firewall_present=False)
    with patch.object(web, 'get_native_remote_bridge_status', side_effect=[initial, final]), \
            patch.object(web, '_run_elevated_windows_powershell', return_value=(True, '')):
        assert web.disable_native_remote_bridge(8765)[0] is True


def _reply_bytes(payload):
    from io import BytesIO
    from secure_remote_tls import NativeHandler
    handler = object.__new__(NativeHandler)
    handler.wfile = BytesIO()
    handler.send_response = lambda status: None
    handler.send_header = lambda *args: None
    handler.end_headers = lambda: None
    handler.reply(200, payload)
    return handler.wfile.getvalue()


def test_catalog_actual_reply_is_byte_bounded_and_preserves_truthful_metadata():
    import json
    import web_ui as web
    from secure_remote import SecureRemote
    for title in ['字' * 140, 'x' * 140, '😀' * 140, '字😀' * 100]:
        remote = SecureRemote(web.RemotePlayerHub())
        remote.activate()
        pair = remote.pair(remote.open_invite(), 'Budget')
        remote.approve(pair['device_id'], 'control')
        source = {
            'playlist': '長' * 10000,
            'total_tracks': 812,
            'active_group_id': 'g_63',
            'groups': [{'id': f'g_{i}', 'name': '😀字' * 100, 'count': 812} for i in range(64)],
            'items': [{'id': f'trk_{i:03}', 'title': title, 'group_id': f'g_{i % 64}'} for i in range(250)]}
        remote.master_poll({'native_track_id': 'trk_249'}, [], 'budget-master-instance', catalog=source)
        payload = remote.tracks(pair['token'])
        body = _reply_bytes(payload)
        assert len(body) <= 98304, len(body)
        assert json.loads(body) == payload
        assert payload['total_tracks'] == 812 and len(payload['groups']) == 64
        assert payload['current_track_id'] == 'trk_249' and payload['active_group_id'] == 'g_63'
        assert 0 < len(payload['tracks']) <= 250
        assert [t['id'] for t in payload['tracks']] == [f'trk_{i:03}' for i in range(len(payload['tracks']))]
        assert _reply_bytes(remote.tracks(pair['token'])) == body
        assert remote.track_ids == {f'trk_{i:03}' for i in range(250)}
        for entry in payload['tracks']:
            assert len(entry['title'].encode('utf-16-le')) // 2 <= 140
        for group in payload['groups']:
            assert len(group['name'].encode('utf-16-le')) // 2 <= 80
        assert len(payload['playlist'].encode('utf-16-le')) // 2 <= 80
        remote.master_poll({'is_playing': False}, [], 'budget-master-instance', catalog={'items': [], 'playlist': {}, 'groups': [], 'total_tracks': 0})
        empty = json.loads(_reply_bytes(remote.tracks(pair['token'])))
        assert empty['tracks'] == [] and empty['groups'] == [] and empty['total_tracks'] == 0
        assert empty['playlist'] is None and empty['current_track_id'] is None


def test_state_title_is_compatible_with_android_utf16_limit():
    from secure_remote import SecureRemote
    from web_ui import RemotePlayerHub
    remote = SecureRemote(RemotePlayerHub())
    remote.activate()
    pair = remote.pair(remote.open_invite(), 'Unicode')
    remote.approve(pair['device_id'], 'view_only')
    remote.master_poll({'track': {'name': '😀' * 160}}, [], 'unicode-master-instance')
    title = remote.state(pair['token'])['state']['track_title']
    assert len(title.encode('utf-16-le')) // 2 <= 160
    assert title == '😀' * 80


def test_firewall_status_uses_machine_properties_not_localized_labels():
    import json
    import web_ui as web
    # Match the actual PowerShell JSON producer, including the rule identity.
    active = dict(name='Swararia Android Remote 8767', enabled=True, inbound=True,
                  allow=True, all_profiles=True, protocol='TCP', local_port='8767')
    fixtures = [(json.dumps([active]), 0, True), ('[]', 0, False),
                (json.dumps([{k: v for k, v in active.items() if k != 'name'}]), 0, None),
                ('Enabled: Yes Direction: In', 0, None), ('', 1, None)]
    for key, value in [('enabled', False), ('inbound', False), ('allow', False), ('all_profiles', False), ('protocol', 'UDP'), ('local_port', '9999')]:
        fixtures.append((json.dumps([dict(active, **{key: value})]), 0, False))
    for output, code, expected in fixtures:
        with patch.object(web, '_find_windows_sys32_bin', return_value='/fake/powershell.exe'), \
                patch.object(web.subprocess, 'run', return_value=SimpleNamespace(returncode=code, stdout=output)) as run:
            assert web._check_windows_firewall_rule('Swararia Android Remote 8767') is expected
            script = base64.b64decode(run.call_args[0][0][-1]).decode('utf-16le')
            for property in ['Get-NetFirewallRule', 'ActiveStore', 'ConvertTo-Json', '.Enabled', '.Direction', '.Action', '.Profile', 'Get-NetFirewallPortFilter']:
                assert property in script
    with patch.object(web, '_find_windows_sys32_bin', return_value=None):
        assert web._check_windows_firewall_rule('Swararia Android Remote 8767') is None
    with patch.object(web, 'is_wsl_environment', return_value=True), \
            patch.object(web, '_get_linux_internal_ips', return_value=['172.20.1.2']), \
            patch.object(web, 'get_local_lan_ips', return_value=['192.168.1.2']), \
            patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8767, '127.0.0.1', 8768)]), \
            patch.object(web, '_inspect_windows_firewall_rules', return_value=None), \
            patch.object(web, '_find_windows_sys32_bin', return_value=None):
        status = web.get_native_remote_bridge_status(8765, 8767, '192.168.1.2', native_local_port=8768)
        assert status['firewall_active'] is None and status['bridge_active'] is False
    with patch.object(web.subprocess, 'run') as run:
        for name in ["Swararia Android Remote 8767';whoami", 'Swararia Android Remote 65536', 'Other 8767']:
            assert web._check_windows_firewall_rule(name) is None
        assert not run.called


def test_reserved_foh_ports_reject_start_and_bridge_without_mutation():
    import web_ui as web
    from secure_remote import SecureRemote
    from test_dual_remote import running
    for linux_ips in [['192.168.85.3'], ['192.168.1.2']]:
        with running() as (_, server, req, origin), \
                patch.object(web, 'is_wsl_environment', return_value=True), \
                patch.object(web, '_active_wsl_foh_ports', {server.server_address[1]: 8769}), \
                patch.object(web, '_get_linux_internal_ips', return_value=linux_ips), \
                patch.object(web, 'get_local_lan_ips', return_value=['192.168.1.2']), \
                patch.object(web, '_find_windows_sys32_bin', return_value=None), \
                patch.object(web, '_run_elevated_windows_powershell') as elevated, \
                patch.object(SecureRemote, 'start') as start:
            port = server.server_address[1]
            for reserved in [port, port + 1, 8769]:
                status, body = req('POST', '/api/native-remote', {'action': 'start', 'bind_ip': '192.168.1.2', 'port': reserved}, origin)
                assert status == 409 and body['code'] == 'wsl_port_reserved'
                st = web.get_native_remote_bridge_status(port, reserved, '192.168.1.2')
                assert st['port_conflict'] is True
                assert web.enable_native_remote_bridge(port, reserved, '192.168.1.2')[0] is False
            assert not start.called and not elevated.called


def test_native_removal_checks_actual_unknown_or_wrong_target_portproxy():
    import web_ui as web
    for rules in [None, [('0.0.0.0', 8767, '10.0.0.8', 1234)]]:
        with patch.object(web, 'is_wsl_environment', return_value=True), \
                patch.object(web, '_get_linux_internal_ips', return_value=['172.20.1.2']), \
                patch.object(web, 'get_local_lan_ips', return_value=['192.168.1.2']), \
                patch.object(web, '_list_windows_portproxy_rules', return_value=rules), \
                patch.object(web, '_check_windows_firewall_rule', return_value=False), \
                patch.object(web, '_find_windows_sys32_bin', return_value=None), \
                patch.object(web, '_run_elevated_windows_powershell', return_value=(True, '')):
            assert web.disable_native_remote_bridge(8765, 8767, '192.168.1.2')[0] is False


def test_foh_removal_does_not_claim_closed_when_rules_remain_or_unknown():
    import web_ui as web
    initial = dict(is_wsl=True, internal_port=8769, bridge_active=True)
    for final in [initial, dict(initial, bridge_active=False),
                  dict(initial, bridge_active=False, has_portproxy=False, firewall_active=None)]:
        with patch.object(web, 'get_wsl_bridge_status', side_effect=[initial, final]), \
                patch.object(web, '_find_windows_sys32_bin', return_value='/fake/powershell.exe'), \
                patch.object(web, 'get_local_lan_ips', return_value=['192.168.1.2']), \
                patch.object(web, '_run_elevated_windows_powershell', return_value=(True, '')):
            assert web.disable_wsl_port_bridge(8765)[0] is False
