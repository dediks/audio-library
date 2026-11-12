"""Resource/cleanup tests only bind loopback; no external services."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_tls_connections_have_absolute_deadline_even_for_partial_requests():
    import socket
    import ssl
    from secure_remote import SecureRemote
    from web_ui import RemotePlayerHub
    remote = SecureRemote(RemotePlayerHub())
    remote.start('127.0.0.1', 0)
    remote.listener.CONNECTION_TTL = 0.15
    context = ssl.create_default_context(cadata=remote.certificate)
    raw = socket.create_connection(remote.listener.server_address, timeout=1)
    client = context.wrap_socket(raw, server_hostname='127.0.0.1')
    try:
        client.settimeout(0.8)
        client.sendall(b'GET /v1/session HTTP/1.1\r\nHost: partial')
        try:
            result = client.recv(1024)
        except ssl.SSLError:
            result = b''
        assert result == b'', 'absolute deadline must close partial HTTP headers'
    finally:
        client.close()
        remote.stop()


def test_shutdown_cannot_join_a_registered_but_unstarted_worker():
    import socket
    import threading
    from unittest.mock import patch
    from secure_remote import SecureRemote
    from secure_remote_tls import NativeTLSServer, tls_context
    from web_ui import RemotePlayerHub
    context, _, _ = tls_context('127.0.0.1')
    server = NativeTLSServer(('127.0.0.1', 0), SecureRemote(RemotePlayerHub()), context)
    left, right = socket.socketpair()
    entered, release = threading.Event(), threading.Event()
    original_start = threading.Thread.start
    def delayed_start(worker):
        if getattr(worker, '_target', None) == server._serve_client:
            entered.set()
            release.wait(1)
        return original_start(worker)
    starter = threading.Thread(target=lambda: server.process_request(left, ('127.0.0.1', 1)), daemon=True)
    timer = threading.Timer(0.1, release.set)
    try:
        with patch.object(threading.Thread, 'start', delayed_start):
            original_start(starter)
            assert entered.wait(1)
            original_start(timer)
            server.server_close()
        starter.join(timeout=2)
        assert not starter.is_alive()
    finally:
        release.set()
        timer.cancel()
        starter.join(timeout=2)
        server.server_close()
        right.close()


def test_local_ui_port_conflict_keeps_legacy_loopback_fallback():
    import socket
    from web_ui import create_server
    busy = socket.socket()
    busy.bind(('127.0.0.1', 0))
    busy.listen(1)
    server = None
    try:
        from unittest.mock import patch
        with patch('web_ui._cleanup_stale_wsl_listen_port'):
            server, port = create_server('127.0.0.1', busy.getsockname()[1])
        assert port != busy.getsockname()[1]
        assert server.server_address[0] == '127.0.0.1'
        assert not server.secure_remote.enabled
    finally:
        if server:
            server.server_close()
        busy.close()


def test_old_windows_temp_runtime_fails_before_creating_key_files():
    from unittest.mock import patch
    import secure_remote_tls
    from secure_remote import RemoteError
    with patch.object(secure_remote_tls.os, 'name', 'nt'), patch.object(secure_remote_tls.sys, 'version_info', (3, 12, 3)), patch.object(secure_remote_tls.tempfile, 'TemporaryDirectory') as temporary:
        try:
            secure_remote_tls.tls_context('127.0.0.1')
            assert False, 'Windows runtimes without secure mkdtemp must fail closed'
        except RemoteError as exc:
            assert exc.code == 'secure_temp_runtime_required'
        temporary.assert_not_called()
