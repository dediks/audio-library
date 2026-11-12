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
