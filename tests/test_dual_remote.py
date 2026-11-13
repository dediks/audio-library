"""Additive browser/native regressions. All live sockets explicit loopback."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import contextlib
import http.client
import json
import threading
from unittest.mock import patch

@contextlib.contextmanager
def running():
    import web_ui
    with patch.object(web_ui, 'remote_hub', web_ui.RemotePlayerHub()), patch.object(web_ui, '_cleanup_stale_wsl_listen_port'):
        server, port = web_ui.create_server('127.0.0.1', 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def request(method, path, payload=None, headers=None):
            conn = http.client.HTTPConnection('127.0.0.1', port, timeout=4)
            h = {'Content-Type': 'application/json'}
            h.update(headers or {})
            conn.request(method, path, json.dumps(payload) if payload is not None else None, h)
            response = conn.getresponse()
            data = response.read()
            conn.close()
            return response.status, json.loads(data) if data else None
        try:
            yield web_ui, server, request, {'Origin': f'http://127.0.0.1:{port}'}
        finally:
            server.shutdown()
            server.server_close()
            thread.join(4)

def test_browser_pin_state_all_actions_and_device_controls():
    with running() as (web, server, req, origin):
        status, info = req('GET', '/api/remote/info')
        assert status == 200, 'legacy browser information must be restored'
        pin = info['pin']
        headers = {'X-FOH-PIN': pin, 'X-FOH-Client-ID': 'browser-test'}
        assert req('GET', '/api/remote/state', headers={'X-FOH-PIN': 'bad'})[0] == 401
        assert req('GET', '/api/remote/state', headers=headers)[0] == 200
        assert len(web.ALLOWED_REMOTE_ACTIONS) == 25
        for action in sorted(web.ALLOWED_REMOTE_ACTIONS):
            assert req('POST', '/api/remote/command', {'action': action, 'params': {'value': 1}}, headers)[0] == 200, action
        status, state = req('POST', '/api/remote/state', {'state': {'is_playing': False}})
        assert status == 200
        assert {c['action'] for c in state['commands']} == web.ALLOWED_REMOTE_ACTIONS
        assert state['active_remotes_count'] == 1
        assert state['pin'] == pin and state['enabled']
        assert req('POST', '/api/remote/state', {})[1]['commands'] == []
        cid = state['active_remotes'][0]['client_id']
        assert req('POST', '/api/remote/clients', {'action': 'set_role', 'client_id': cid, 'role': 'view_only'})[0] == 200
        assert req('POST', '/api/remote/command', {'action': 'play'}, headers)[1]['code'] == 'VIEW_ONLY'
        assert req('POST', '/api/remote/clients', {'action': 'kick', 'client_id': cid})[1]['active_remotes_count'] == 0
        assert req('GET', '/api/remote/state', headers=headers)[1]['code'] == 'KICKED'
        assert req('POST', '/api/remote/clients', {'action': 'unblock', 'client_id': cid})[0] == 200
        assert req('POST', '/api/remote/state', {'enabled': False})[1]['enabled'] is False
        assert req('GET', '/api/remote/state', headers=headers)[1]['code'] == 'DISABLED'
        assert req('POST', '/api/remote/state', {'enabled': True, 'regenerate_pin': True})[0] == 200
        assert web.remote_hub.get_clients_lists() == ([], [])
        with patch.object(web, 'enable_wsl_port_bridge', return_value=(True, 'ok', {})) as bridge:
            assert req('POST', '/api/remote/wsl-bridge', {})[0] == 200
            bridge.assert_called_once()


def test_shared_master_queue_is_once_only_and_browser_reset_preserves_native():
    with running() as (web, server, req, origin):
        remote = server.secure_remote
        remote.activate()
        pair = remote.pair(remote.open_invite(), 'native-test')
        remote.approve(pair['device_id'], 'control')
        payload = {'state': {'is_playing': False}, 'master_instance': 'dual-master-instance', 'native_acks': []}
        assert req('POST', '/api/remote/state', payload)[0] == 403, 'native fields require Origin even on loopback'
        assert req('POST', '/api/remote/state', payload, origin)[0] == 200
        native = remote.command(pair['token'], 'play', 'dual-request-001')
        headers = {'X-FOH-PIN': web.remote_hub.pin}
        assert req('POST', '/api/remote/command', {'action': 'stop'}, headers)[0] == 200
        # Old master may consume browser work, but never native work or native heartbeat.
        plain = req('POST', '/api/remote/state', {'state': {'is_playing': False}})[1]
        assert [c['action'] for c in plain['commands']] == ['stop']
        assert req('POST', '/api/remote/state', {'enabled': False})[0] == 200
        assert req('POST', '/api/remote/state', {'regenerate_pin': True})[0] == 200
        assert len(web.remote_hub.command_queue) == 1
        result = req('POST', '/api/remote/state', payload, origin)[1]
        assert [c['native_id'] for c in result['commands']] == [native['command_id']]
        assert result['active_remotes_count'] == 0
        assert result['enabled'] is False and remote.enabled is True
        assert req('POST', '/api/remote/state', payload, origin)[1]['commands'] == []
        claim = {'command_id': native['command_id'], 'master_instance': 'dual-master-instance'}
        assert req('POST', '/api/native-remote/claim', claim)[0] == 403
        assert req('POST', '/api/native-remote/claim', claim, origin)[1]['authorized'] is True
        payload['native_acks'] = [{'command_id': native['command_id'], 'status': 'applied', 'observed': {'is_playing': True}}]
        assert req('POST', '/api/remote/state', payload, origin)[0] == 200
        assert remote.command_status(pair['token'], native['command_id'])['status'] == 'applied'
        req('POST', '/api/remote/state', {'enabled': True})
        combined_native = remote.command(pair['token'], 'pause', 'dual-request-002')
        req('POST', '/api/remote/command', {'action': 'stop'}, {'X-FOH-PIN': web.remote_hub.pin})
        combined = req('POST', '/api/remote/state', payload, origin)[1]
        assert [c['action'] for c in combined['commands']] == ['pause', 'stop']
        assert combined['commands'][0]['native_id'] == combined_native['command_id']
        assert 'native_id' not in combined['commands'][1]
        assert combined['active_remotes_count'] == 1 and len(combined['active_remotes']) == 1
        assert req('POST', '/api/remote/state', payload, origin)[1]['commands'] == []
        req('POST', '/api/remote/state', {'enabled': True})
        req('POST', '/api/remote/command', {'action': 'pause'}, {'X-FOH-PIN': web.remote_hub.pin})
        remote.stop()
        assert web.remote_hub.enabled is True
        assert req('POST', '/api/remote/state', {})[1]['commands'][0]['action'] == 'pause'


def test_simulated_lan_socket_keeps_browser_allowlist_but_cannot_forge_native_owner():
    with running() as (web, server, req, origin):
        class LanPeer(web.AudioServerHandler):
            def __init__(self, request, address, owner):
                super().__init__(request, ('192.168.1.50', address[1]), owner)
        server.RequestHandlerClass = LanPeer
        forged = {**origin, 'Forwarded': 'for=127.0.0.1', 'X-Forwarded-For': '127.0.0.1', 'X-FOH-PIN': web.remote_hub.pin}
        status, info = req('GET', '/api/remote/info', headers=forged)
        assert status == 200 and info['is_localhost'] is False
        assert 'pin' not in info and 'wsl_bridge' not in info and 'active_remotes' not in info
        assert req('GET', '/api/remote/state', headers=forged)[0] == 200
        assert req('POST', '/api/remote/command', {'action': 'play'}, forged)[0] == 200
        # Consume HTML/static without JSON decoding using a real loopback socket.
        for path, expected in [('/', 302), ('/index.html', 302), ('/player', 200), ('/player.html', 200), ('/static/player.js', 200), ('/api/library', 200), ('/api/system', 200)]:
            conn = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=4)
            conn.request('GET', path, headers=forged)
            response = conn.getresponse()
            assert response.status == expected, path
            if expected == 302:
                assert response.getheader('Location') == '/player?remote=1'
            response.read()
            conn.close()
        for method, path in [('GET', '/api/native-remote'), ('POST', '/api/native-remote'), ('POST', '/api/native-remote/claim'), ('POST', '/api/remote/state'), ('POST', '/api/remote/clients'), ('POST', '/api/remote/wsl-bridge'), ('POST', '/api/download'), ('POST', '/api/rename'), ('GET', '/api/queue')]:
            assert req(method, path, {} if method == 'POST' else None, forged)[0] == 403, path
        assert server.secure_remote.master_instance is None


def test_browser_reset_and_disconnect_all_only_clear_browser_commands():
    import web_ui
    for operation in [lambda hub: hub.set_enabled(False), lambda hub: hub.regenerate_pin(), lambda hub: hub.kick_all_clients()]:
        hub = web_ui.RemotePlayerHub()
        hub.command_queue = [{'native_id': 'native-marker', 'action': 'play'}, {'action': 'stop'}]
        operation(hub)
        assert hub.command_queue == [{'native_id': 'native-marker', 'action': 'play'}]


def test_original_browser_modal_and_setup_block_have_exact_20702751_parity():
    import hashlib
    root = Path(__file__).resolve().parents[1]
    html = (root / 'static/player.html').read_text()
    start = html.index('  <div class="modal-backdrop hidden" id="remoteModal"')
    end = html.index('\n  </div>', start) + len('\n  </div>')
    assert hashlib.sha256(html[start:end].encode()).hexdigest() == '3a9202971f1ee48085253ce3c8c966ef47b153d9e55cca5af65c41628953de7d'
    js = (root / 'static/player.js').read_text()
    block = js[js.index('  let currentRemoteServerPort'):js.index('  const androidRemoteModal =')]
    assert hashlib.sha256(block.encode()).hexdigest() == 'd133d73f3229f09bafcaca737ec3c103bcbe18cdebc33fb2c059a082845712c2'
    import re
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids)), 'browser and Android selectors must be unique'
    assert 'Android 0.5' in html and 'Browser remote HTTP/PIN lama sudah dinonaktifkan' not in html


def test_native_dialog_connect_form_wraps_without_changing_browser_modal():
    html = (Path(__file__).resolve().parents[1] / 'static/player.html').read_text()
    native = html[html.index('id="androidRemoteModal"'):]
    css = (Path(__file__).resolve().parents[1] / 'static/native-remote.css').read_text()
    assert 'href="/static/native-remote.css"' in html
    assert 'id="nativeSettings"' in native and 'class="native-fields"' in native
    assert '#androidRemoteModal .native-fields { display:grid;' in css
    assert 'grid-template-columns:minmax(0,1fr) 110px' in css
    assert '#androidRemoteModal .native-fields .toolbar-input { width:100%; min-width:0;' in css


def test_wsl_foh_companion_bridge_security_and_forwarding():
    import web_ui as web
    hub = web.RemotePlayerHub()
    original_bind = web.LocalAudioServer.server_bind

    def loopback_primary_bind(server):
        # Preserve logical wildcard startup (which creates the FOH companion),
        # but never open a LAN socket in this integration fixture.
        assert server.server_address[0] == '0.0.0.0'
        server.server_address = ('127.0.0.1', server.server_address[1])
        return original_bind(server)

    with patch.object(web, 'remote_hub', hub), \
            patch.object(web.LocalAudioServer, 'server_bind', loopback_primary_bind), \
            patch.object(web, 'is_wsl_environment', return_value=True), \
            patch.object(web, '_cleanup_stale_wsl_listen_port'), \
            patch.object(web, '_get_linux_internal_ips', return_value=['192.168.85.3']), \
            patch.object(web, 'get_local_lan_ips', return_value=['192.168.18.47']):
        server, primary_port = web.create_server('0.0.0.0', 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            internal_port = server.wsl_foh_internal_port
            assert internal_port is not None
            assert internal_port not in (primary_port, primary_port + 1)
            assert web._get_wsl_foh_internal_port(primary_port) == internal_port
            bridge_port = web._get_wsl_remote_bridge_port(primary_port)

            def bridged_req(method, path, payload=None, headers=None, expect_json=True):
                conn = http.client.HTTPConnection('127.0.0.1', internal_port, timeout=4)
                h = {'Content-Type': 'application/json'}
                h.update(headers or {})
                conn.request(method, path, json.dumps(payload) if payload is not None else None, h)
                resp = conn.getresponse()
                raw = resp.read()
                loc = resp.getheader('Location')
                conn.close()
                if expect_json and raw:
                    return resp.status, json.loads(raw), loc
                return resp.status, raw, loc

            lan_host = {'Host': f'192.168.18.47:{bridge_port}'}
            assert bridged_req('GET', '/api/system', headers=lan_host)[0] == 200
            st_root, _, loc_root = bridged_req('GET', '/', headers=lan_host, expect_json=False)
            assert st_root == 302 and loc_root == '/player?remote=1'
            assert bridged_req('GET', '/player', headers=lan_host, expect_json=False)[0] == 200
            st_info, info, _ = bridged_req('GET', '/api/remote/info', headers=lan_host)
            assert st_info == 200
            assert info['is_localhost'] is False and info['port'] == bridge_port
            assert 'pin' not in info and 'wsl_bridge' not in info and 'active_remotes' not in info

            foh_headers = {**lan_host, 'X-FOH-PIN': hub.pin, 'X-FOH-Client-ID': 'hp-wsl-test'}
            assert bridged_req('GET', '/api/remote/state', headers=foh_headers)[0] == 200
            assert bridged_req('POST', '/api/remote/command', {'action': 'play'}, headers=foh_headers)[0] == 200

            forged = {'Host': f'127.0.0.1:{primary_port}', 'Origin': f'http://127.0.0.1:{primary_port}'}
            _, forged_info, _ = bridged_req('GET', '/api/remote/info', headers=forged)
            assert forged_info['is_localhost'] is False
            assert 'pin' not in forged_info and 'wsl_bridge' not in forged_info and 'active_remotes' not in forged_info
            for method, path, body in [
                ('GET', '/api/native-remote', None),
                ('GET', '/api/download?path=foo', None),
                ('GET', '/api/queue', None),
                ('POST', '/api/native-remote', {'action': 'start'}),
                ('POST', '/api/remote/state', {'state': {}}),
                ('POST', '/api/remote/clients', {'action': 'kick', 'client_id': 'hp-wsl-test'}),
                ('POST', '/api/remote/wsl-bridge', {}),
            ]:
                assert bridged_req(method, path, body, headers=forged)[0] == 403, f'{method} {path} must reject bridged forgery'
        finally:
            server.shutdown()
            server.server_close()
            thread.join(4)
            assert primary_port not in web._active_wsl_foh_ports


def test_wsl_foh_bridge_status_targets_internal_port_and_avoids_native_collision():
    import web_ui as web
    with patch.object(web, 'is_wsl_environment', return_value=True), \
            patch.object(web, '_active_wsl_foh_ports', {}), \
            patch.object(web, '_get_linux_internal_ips', return_value=['192.168.85.3']), \
            patch.object(web, 'get_local_lan_ips', return_value=['192.168.18.47']):
        assert web._get_wsl_remote_bridge_port(8765) == 8766
        assert web._get_native_remote_default_port(8765) == 8767
        assert web._get_wsl_native_internal_port(8767, 8765) == 8768
        assert web._get_wsl_foh_internal_port(8765) == 8769
        assert web._get_wsl_native_internal_port(8768, 8765) not in {8765, 8766, 8768, 8769}

        def fake_bin(name):
            return f'/fake/{name}' if name in ('netsh.exe', 'curl.exe') else None

        with patch.object(web, '_find_windows_sys32_bin', side_effect=fake_bin), \
                patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8766, '192.168.85.3', 8765)]), \
                patch.object(web, '_inspect_windows_firewall_rules', return_value={'Swararia FOH Remote 8766': True}), \
                patch.object(web, '_verify_windows_http_reachable', return_value=False):
            st_old = web.get_wsl_bridge_status(8765)
            assert st_old['bridge_active'] is False
            assert st_old['bridge_port'] == 8766 and st_old['internal_port'] == 8769
            assert 'connectport=8769 connectaddress=127.0.0.1' in st_old['powershell_admin_cmd']

        with patch.object(web, '_find_windows_sys32_bin', side_effect=lambda n: '/fake/netsh.exe' if n == 'netsh.exe' else None), \
                patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8766, '192.168.85.3', 8765)]), \
                patch.object(web, '_inspect_windows_firewall_rules', return_value={'Swararia FOH Remote 8766': True}):
            assert web.get_wsl_bridge_status(8765)['bridge_active'] is False

        with patch.object(web, '_find_windows_sys32_bin', side_effect=fake_bin), \
                patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8766, '127.0.0.1', 8769)]), \
                patch.object(web, '_inspect_windows_firewall_rules', return_value={'Swararia FOH Remote 8766': True}), \
                patch.object(web, '_verify_windows_http_reachable', return_value=True):
            assert web.get_wsl_bridge_status(8765)['bridge_active'] is True

        with patch.object(web, '_find_windows_sys32_bin', side_effect=fake_bin), \
                patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8766, '127.0.0.1', 8769)]), \
                patch.object(web, '_inspect_windows_firewall_rules', return_value={'Swararia FOH Remote 8766': False}), \
                patch.object(web, '_verify_windows_http_reachable', return_value=True):
            assert web.get_wsl_bridge_status(8765)['bridge_active'] is False

        with patch.object(web, '_find_windows_sys32_bin', side_effect=lambda n: '/fake/' + n if n in ('powershell.exe', 'netsh.exe', 'curl.exe') else None), \
                patch.object(web, '_run_elevated_windows_powershell', return_value=(True, '')) as run_ps, \
                patch.object(web, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', 8766, '127.0.0.1', 8769)]), \
                patch.object(web, '_inspect_windows_firewall_rules', return_value={'Swararia FOH Remote 8766': True}), \
                patch.object(web, '_verify_windows_http_reachable', return_value=True):
            ok_en, msg_en, st_en = web.enable_wsl_port_bridge(8765)
            assert ok_en is True and st_en['bridge_active'] is True and '127.0.0.1:8769' in msg_en
            en_cmd = ' '.join(run_ps.call_args[0][0])
            assert 'connectport=8769 connectaddress=127.0.0.1' in en_cmd
            assert 'listenport=8765' in en_cmd and 'Swararia FOH Remote 8766' in en_cmd

            run_ps.reset_mock()
            ok_dis, _, _ = web.disable_wsl_port_bridge(8765)
            assert ok_dis is False, 'unchanged mocked rules must not claim removal'
            dis_cmd = ' '.join(run_ps.call_args[0][0])
            assert 'listenport=8766' in dis_cmd and 'listenport=8769' in dis_cmd
