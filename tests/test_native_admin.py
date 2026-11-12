"""Local administration boundary and real localhost-to-TLS command handoff."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_local_admin_csrf_lifecycle_and_native_command_handoff():
    import http.client
    import json
    import ssl
    import threading
    import web_ui
    import inspect
    assert inspect.signature(web_ui.create_server).parameters['host'].default == '0.0.0.0'  # accepted browser LAN compatibility
    from unittest.mock import patch
    with patch.object(web_ui, '_cleanup_stale_wsl_listen_port'):
        server, port = web_ui.create_server('127.0.0.1', port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{port}'
    def local(method, path, payload=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=4)
        h = {'Content-Type': 'application/json', 'Origin': origin}
        h.update(headers or {})
        if h.get('Origin') is None:
            del h['Origin']
        if path == '/api/remote/state' and payload is not None:
            payload = {**payload, 'master_instance': 'integration-master-one'}
        c.request(method, path, json.dumps(payload) if payload is not None else None, h)
        r = c.getresponse()
        body = json.loads(r.read())
        c.close()
        return r.status, body
    try:
        assert server.server_address[0] == '127.0.0.1', 'plaintext UI must be loopback only'
        assert local('GET', '/api/native-remote')[1]['enabled'] is False
        for headers in ({'Origin': 'http://evil.test'}, {'Origin': None}, {'Host': 'evil.test'},
                        {'Sec-Fetch-Site': 'cross-site'}, {'Sec-Fetch-Site': 'same-site'},
                        {'Content-Type': 'text/plain'}):
            assert local('POST', '/api/native-remote', {'action': 'invite_open'}, headers)[0] in (403, 415)
        assert local('GET', '/api/native-remote?ignored=1')[0] == 404
        from unittest.mock import patch
        with patch.object(web_ui, 'enable_wsl_port_bridge', return_value=(True, 'ok', {})):
            assert local('POST', '/api/remote/wsl-bridge', {})[0] == 200
        assert local('POST', '/api/remote/command', {'pin': web_ui.remote_hub.pin, 'action': 'play'})[0] == 200
        web_ui.remote_hub.update_master_state({})
        status, info = local('POST', '/api/native-remote', {'action': 'start', 'bind_ip': '127.0.0.1', 'port': 0})
        assert status == 200 and info['enabled']
        _, info = local('POST', '/api/native-remote', {'action': 'invite_open'})
        remote = server.secure_remote
        token_context = ssl.create_default_context(cadata=remote.certificate)
        tls_port = remote.listener.server_address[1]
        def native(method, path, token, payload=None):
            c = http.client.HTTPSConnection('127.0.0.1', tls_port, timeout=4, context=token_context)
            c.request(method, path, json.dumps(payload) if payload is not None else None,
                      {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            r = c.getresponse()
            body = json.loads(r.read())
            c.close()
            return r.status, body
        _, pair = native('POST', '/v1/pair', info['invite'], {'label': '<script>HP</script>'})
        _, info = local('GET', '/api/native-remote')
        assert info['devices'][0]['status'] == 'pending'
        assert local('POST', '/api/native-remote', {'action': 'approve', 'device_id': pair['device_id'], 'role': 'control'})[0] == 200
        assert local('POST', '/api/remote/state', {'state': {'track': {'rel_path': 'private.wav'}, 'is_playing': False}})[0] == 200
        _, command = native('POST', '/v1/commands', pair['token'], {'action': 'play', 'idempotency_key': 'request-1234'})
        assert command['status'] == 'accepted'
        _, master = local('POST', '/api/remote/state', {'state': {'is_playing': False}})
        assert master['commands'][0]['native_id'] == command['command_id']
        assert native('GET', '/v1/commands/' + command['command_id'], pair['token'])[1]['status'] == 'pending'
        assert local('POST', '/api/native-remote/claim', {'command_id': command['command_id'], 'master_instance': 'integration-master-one'})[1]['authorized'] is True
        assert local('POST', '/api/native-remote/claim', {'command_id': command['command_id'], 'master_instance': 'integration-master-one'}, {'Origin': 'http://evil.test'})[0] == 403
        _, master = local('POST', '/api/remote/state', {'state': {'is_playing': True}, 'native_acks': [
            {'command_id': command['command_id'], 'status': 'applied', 'observed': {'is_playing': True}}]})
        assert master['commands'] == []
        assert native('GET', '/v1/commands/' + command['command_id'], pair['token'])[1]['status'] == 'applied'
        assert 'track' not in native('GET', '/v1/state', pair['token'])[1]['state']
        assert local('POST', '/api/native-remote', {'action': 'revoke', 'device_id': pair['device_id']})[0] == 200
        assert native('GET', '/v1/state', pair['token'])[1]['code'] == 'revoked'
        assert web_ui.remote_hub.master_state['is_playing'] is True
        assert local('POST', '/api/native-remote', {'action': 'stop'})[1]['enabled'] is False
        assert web_ui.remote_hub.master_state['is_playing'] is True
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=4)
    assert server.secure_remote.listener is None


def test_plaintext_nonlocal_gate_does_not_trust_forwarded_headers():
    from web_ui import AudioServerHandler
    from email.message import Message
    from io import BytesIO
    for method, path in [('GET', '/api/native-remote'), ('POST', '/api/native-remote/claim'),
                         ('POST', '/api/remote/state'), ('POST', '/api/download'),
                         ('POST', '/api/remote/wsl-bridge'), ('GET', '/api/queue')]:
        handler = AudioServerHandler.__new__(AudioServerHandler)
        handler.path = path
        handler.client_address = ('192.168.1.50', 9999)
        handler.headers = Message()
        handler.headers['Host'] = '127.0.0.1:8765'
        handler.headers['Forwarded'] = 'for=127.0.0.1'
        handler.headers['X-Forwarded-For'] = '127.0.0.1'
        handler.rfile = BytesIO(b'{}')
        result = []
        handler.send_json = lambda code, body: result.append(code)
        getattr(handler, 'do_' + method)()
        assert result == [403], (method, path, result)


def test_desktop_launcher_uses_local_owner_and_cleans_tls():
    import contextlib
    import io
    import types
    from unittest.mock import patch
    import desktop_app
    import web_ui
    servers = []
    real_create = web_ui.create_server
    def create(host, port):
        assert host == '0.0.0.0', 'desktop preserves browser LAN startup; test substitutes loopback'
        from unittest.mock import patch
        with patch.object(web_ui, '_cleanup_stale_wsl_listen_port'):
            server, actual = real_create('127.0.0.1', 0)
        servers.append(server)
        return server, actual
    def start_view():
        server = servers[0]
        assert not server.secure_remote.enabled
        server.secure_remote.start('127.0.0.1', 0)
    fake_view = types.SimpleNamespace(create_window=lambda **kw: object(), start=start_view)
    output = io.StringIO()
    previous = sys.modules.get('webview')
    sys.modules['webview'] = fake_view
    try:
        with patch.dict('os.environ', {'SWARARIA_FORCE_BROWSER': '0'}), patch.object(web_ui, 'create_server', create), patch.object(web_ui, 'get_local_lan_ips', return_value=['10.0.0.2']), contextlib.redirect_stdout(output):
            assert desktop_app.main() == 0
    finally:
        if previous is None:
            sys.modules.pop('webview', None)
        else:
            sys.modules['webview'] = previous
    assert servers[0].secure_remote.listener is None
    assert not servers[0].secure_remote.enabled
    assert 'Security PIN' in output.getvalue()
    assert 'http://192.' not in output.getvalue()


def test_cli_launcher_preserves_browser_startup_and_cleans_tls():
    import contextlib
    import io
    from unittest.mock import patch
    import web_ui
    real_create = web_ui.create_server
    servers = []
    def create(host, port):
        assert host == '0.0.0.0'
        from unittest.mock import patch
        with patch.object(web_ui, '_cleanup_stale_wsl_listen_port'):
            server, actual = real_create('127.0.0.1', 0)
        servers.append(server)
        def serve():
            server.secure_remote.start('127.0.0.1', 0)
            raise KeyboardInterrupt()
        server.serve_forever = serve
        return server, actual
    output = io.StringIO()
    with patch.object(web_ui, 'create_server', create), patch.object(web_ui, 'get_local_lan_ips', return_value=['10.0.0.2']), patch.object(sys, 'argv', ['web_ui.py']), contextlib.redirect_stdout(output):
        web_ui.main()
    assert servers[0].secure_remote.listener is None
    assert 'Security PIN' in output.getvalue()


def test_wsl2_nat_maps_windows_wifi_ip_avoids_foh_port_and_gates_bridge():
    import http.client
    import json
    import socket
    import ssl
    import threading
    from unittest.mock import patch
    from cryptography import x509
    import web_ui

    with socket.socket() as s1, socket.socket() as s2:
        s1.bind(('127.0.0.1', 0))
        pub_port = s1.getsockname()[1]
        s2.bind(('127.0.0.1', 0))
        priv_port = s2.getsockname()[1]

    with patch.object(web_ui, '_cleanup_stale_wsl_listen_port'):
        server, port = web_ui.create_server('127.0.0.1', port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{port}'

    def local(method, path, payload=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=4)
        h = {'Content-Type': 'application/json', 'Origin': origin}
        h.update(headers or {})
        if h.get('Origin') is None:
            del h['Origin']
        c.request(method, path, json.dumps(payload) if payload is not None else None, h)
        r = c.getresponse()
        body = json.loads(r.read())
        c.close()
        return r.status, body

    try:
        foh_port = port + 1
        with patch.object(web_ui, 'is_wsl_environment', return_value=True), \
                patch.object(web_ui, '_get_linux_internal_ips', return_value=['192.168.85.3']), \
                patch.object(web_ui, 'get_local_lan_ips', return_value=['192.168.18.47']):
            st, info = local('GET', '/api/native-remote')
            assert st == 200
            assert info['default_bind_ip'] == '192.168.18.47'
            assert info['is_wsl'] is True and info['is_wsl_nat'] is True
            assert info['default_port'] != port and info['default_port'] != foh_port
            assert 'wsl_bridge' not in info and 'pin' not in info and 'active_remotes' not in info

            # Must refuse colliding with FOH WSL bridge port (port + 1).
            st_res, body_res = local('POST', '/api/native-remote', {
                'action': 'start', 'bind_ip': '192.168.18.47', 'port': foh_port
            })
            assert st_res == 409 and body_res['code'] == 'wsl_port_reserved'

            # Starting with Windows Wi-Fi IP in WSL2 binds loopback internal port & puts Wi-Fi IP in cert SAN.
            with patch.object(web_ui, '_get_wsl_native_internal_port', return_value=priv_port):
                st_ok, info_ok = local('POST', '/api/native-remote', {
                    'action': 'start', 'bind_ip': '192.168.18.47', 'port': pub_port
                })
            assert st_ok == 200 and info_ok['enabled'] is True
            assert info_ok['url'] == f'https://192.168.18.47:{pub_port}'
            assert info_ok['bind_url'] == f'https://127.0.0.1:{priv_port}'
            cert = x509.load_pem_x509_certificate(server.secure_remote.certificate.encode('ascii'))
            san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            assert {str(ip) for ip in san.get_values_for_type(x509.IPAddress)} == {'127.0.0.1', '192.168.18.47'}

            # Native bridge endpoint must verify localhost/Origin and inspect Windows rules cleanly.
            assert local('GET', '/api/native-remote/wsl-bridge?foo=1')[0] == 404
            assert local('POST', '/api/native-remote/wsl-bridge', {'action': 'status'}, {'Origin': 'http://evil.test'})[0] == 403
            with patch.object(web_ui, '_list_windows_portproxy_rules', return_value=[('0.0.0.0', pub_port, '127.0.0.1', priv_port)]), \
                    patch.object(web_ui, '_check_windows_firewall_rule', return_value=True), \
                    patch.object(web_ui, '_find_windows_sys32_bin', return_value='/fake/curl.exe'), \
                    patch.object(web_ui, '_verify_windows_tls_reachable', return_value=True):
                st_b, body_b = local('POST', '/api/native-remote/wsl-bridge', {'action': 'status'})
                assert st_b == 200 and body_b['bridge']['bridge_active'] is True
                assert body_b['bridge']['public_port'] == pub_port and body_b['bridge']['internal_port'] == priv_port
                assert 'connectport=' + str(priv_port) in body_b['bridge']['powershell_admin_cmd']

            local('POST', '/api/native-remote', {'action': 'stop'})
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=4)


def test_local_request_allowed_accepts_ipv6_loopback_host_with_matching_port():
    from email.message import Message
    from web_ui import AudioServerHandler

    class DummyServer:
        server_address = ('127.0.0.1', 8765)

    h = AudioServerHandler.__new__(AudioServerHandler)
    h.server = DummyServer()
    h.client_address = ('::1', 54321)
    h.headers = Message()
    h.headers['Host'] = '[::1]:8765'
    h.headers['Origin'] = 'http://[::1]:8765'
    assert h.local_request_allowed(write=True) is True

    h.headers.replace_header('Host', '[::1]:9999')
    assert h.local_request_allowed(write=True) is False
