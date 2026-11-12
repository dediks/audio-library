"""Bounded private-IPv4 TLS transport. No static files, redirects or request logs."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import sys
import tempfile
import threading
import time

from secure_remote import RemoteError


def tls_context(host, extra_ips=()):
    # CPython 3.12.4 fixed Windows mkdtemp permissions (CVE-2024-4030).
    # Never write session keys using an older Windows runtime's inherited ACLs.
    if os.name == 'nt' and tuple(sys.version_info[:3]) < (3, 12, 4):
        raise RemoteError('secure_temp_runtime_required', 503)
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    san_ips = list(dict.fromkeys(ipaddress.ip_address(ip) for ip in (host, *extra_ips) if ip))
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Swararia session remote')])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(hours=12))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(addr) for addr in san_ips]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .sign(key, hashes.SHA256()))
    pem = cert.public_bytes(serialization.Encoding.PEM)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    # Windows inherits owner ACLs from its user temp directory; POSIX also sets
    # restrictive modes. Files are gone before the listener accepts any clients.
    with tempfile.TemporaryDirectory(prefix='swararia-tls-') as directory:
        os.chmod(directory, 0o700)
        paths = []
        for name, data in [('cert.pem', pem), ('key.pem', key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))]:
            path = Path(directory) / name
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
            paths.append(str(path))
        context.load_cert_chain(*paths)
    return context, pem.decode('ascii'), cert.fingerprint(hashes.SHA256()).hex()


def validate_bind(host, port):
    try:
        ip = ipaddress.IPv4Address(host)
        allowed = ip.is_loopback or any(ip in ipaddress.ip_network(n) for n in
                                        ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
        if not allowed or type(port) is not int or not (1 <= port <= 65535 or port == 0 and ip.is_loopback):
            raise ValueError()
    except (ValueError, TypeError, ipaddress.AddressValueError):
        raise RemoteError('invalid_bind', 400) from None


class NativeTLSServer(HTTPServer):
    # POSIX SO_REUSEADDR allows immediate rebind after TIME_WAIT without permitting
    # another live socket to hijack the port; Windows keeps SO_REUSEADDR disabled.
    allow_reuse_address = os.name == 'posix'
    request_queue_size = 16
    CONNECTION_TTL = 6

    def __init__(self, address, owner, context):
        self.owner, self.context = owner, context
        self.slots = threading.BoundedSemaphore(16)
        self.sockets = set()
        self.workers = set()
        self.guard = threading.Lock()
        self.closing = False
        self.buckets = {'all': [120.0, time.monotonic()], 'pair': [10.0, time.monotonic()]}
        super().__init__(address, NativeHandler)

    def rate(self, category):
        with self.guard:
            capacity, refill = (120, 20) if category == 'all' else (10, 1 / 6)
            bucket = self.buckets[category]
            now = time.monotonic()
            bucket[0] = min(capacity, bucket[0] + (now - bucket[1]) * refill)
            bucket[1] = now
            if bucket[0] < 1:
                raise RemoteError('rate_limited', 429)
            bucket[0] -= 1

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        worker = threading.Thread(target=self._serve_client, args=(request, address), daemon=True)
        with self.guard:
            if self.closing:
                self.slots.release()
                request.close()
                return
            self.sockets.add(request)
            self.workers.add(worker)
            # Publish/start atomically with respect to shutdown's worker snapshot.
            worker.start()

    def _serve_client(self, raw, address):
        connection = raw
        def deadline():
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        timer = threading.Timer(self.CONNECTION_TTL, deadline)
        timer.daemon = True
        timer.start()
        try:
            raw.settimeout(3)
            connection = self.context.wrap_socket(raw, server_side=True, do_handshake_on_connect=False)
            with self.guard:
                self.sockets.discard(raw)
                self.sockets.add(connection)
                if self.closing:
                    return
            connection.do_handshake()
            self.finish_request(connection, address)
        except (OSError, ValueError):
            pass  # Never print raw requests, credentials, SSL or parser exceptions.
        finally:
            timer.cancel()
            # Send TLS close_notify before closing a connection whose rejected
            # body may still be in flight. Never drain unbounded attacker data.
            if isinstance(connection, ssl.SSLSocket):
                try:
                    connection.settimeout(0.2)
                    connection.unwrap().close()
                except (OSError, ValueError):
                    pass
            connection.close()
            raw.close()
            with self.guard:
                self.sockets.discard(raw)
                self.sockets.discard(connection)
                self.workers.discard(threading.current_thread())
            self.slots.release()

    def server_close(self):
        with self.guard:
            self.closing = True
            for connection in list(self.sockets):
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()
            workers = list(self.workers)
        super().server_close()
        for worker in workers:
            worker.join(timeout=4)

    def handle_error(self, request, client_address):
        pass


class NativeHandler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'
    timeout = 3
    server_version = 'SwarariaNative/1'
    sys_version = ''

    def log_message(self, *args):
        pass

    def log_error(self, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self.reply(code, {'code': 'invalid_request'})

    def reply(self, status, data):
        self.close_connection = True
        body = json.dumps(data, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)

    def parse_request(self):
        valid = super().parse_request()
        if valid:
            # BaseHTTPRequestHandler normalizes // to /. Reject the original.
            pieces = self.raw_requestline.split()
            if len(pieces) != 3 or pieces[1].startswith(b'//'):
                self.reply(404, {'code': 'unknown_route'})
                return False
        return valid

    def _token(self):
        values = self.headers.get_all('Authorization', [])
        if len(values) != 1 or not values[0].startswith('Bearer '):
            raise RemoteError('unauthorized', 401)
        token = values[0][7:]
        if not 20 <= len(token) <= 128:
            raise RemoteError('unauthorized', 401)
        return token

    def _body(self):
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get_all('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]{1,8}', lengths[0]):
            raise RemoteError('invalid_length', 400)
        length = int(lengths[0])
        if length > 4096:
            raise RemoteError('body_too_large', 413)
        data = self.rfile.read(length)
        if self.headers.get('Content-Type', '').lower() != 'application/json':
            raise RemoteError('json_required', 415)
        try:
            def unique(pairs):
                value = {}
                for k, v in pairs:
                    if k in value:
                        raise ValueError()
                    value[k] = v
                return value
            if len(data) != length:
                raise ValueError()
            payload = json.loads(data, object_pairs_hook=unique,
                                 parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            if not isinstance(payload, dict):
                raise ValueError()
            return payload
        except (ValueError, UnicodeError, RecursionError):
            raise RemoteError('invalid_json', 400) from None

    def _dispatch(self):
        owner = self.server.owner
        self.server.rate('all')
        fixed = {'/v1/pair', '/v1/session', '/v1/capabilities', '/v1/state', '/v1/commands'}
        status_route = re.fullmatch(r'/v1/commands/([A-Za-z0-9_-]{24})', self.path)
        if self.path not in fixed and not status_route:
            raise RemoteError('unknown_route', 404)
        if self.headers.get('Origin') or self.headers.get('Sec-Fetch-Site'):
            raise RemoteError('native_clients_only')
        if self.command == 'POST':
            payload = self._body()
            if self.path == '/v1/pair':
                self.server.rate('pair')
                if set(payload) != {'label'}:
                    raise RemoteError('invalid_fields', 400)
                return 202, owner.pair(self._token(), payload['label'])
            if self.path == '/v1/commands':
                if set(payload) != {'action', 'idempotency_key'}:
                    raise RemoteError('invalid_fields', 400)
                return 202, owner.command(self._token(), payload['action'], payload['idempotency_key'])
            raise RemoteError('method_not_allowed', 405)
        if self.command != 'GET':
            raise RemoteError('method_not_allowed', 405)
        if self.headers.get_all('Transfer-Encoding') or self.headers.get('Content-Length', '0') != '0':
            raise RemoteError('invalid_length', 400)
        token = self._token()
        if self.path == '/v1/session':
            return 200, owner.session(token)
        if self.path == '/v1/state':
            return 200, owner.state(token)
        if status_route:
            return 200, owner.command_status(token, status_route[1])
        if self.path == '/v1/capabilities':
            with owner.lock:
                owner._device(token, active=True)
            return 200, {'protocol': 'v1', 'commands': ['play', 'pause', 'stop'],
                         'media': False, 'command_ttl_seconds': owner.COMMAND_TTL,
                         'idempotency_ttl_seconds': owner.RECORD_TTL}
        raise RemoteError('method_not_allowed', 405)

    def do_GET(self):
        try:
            status, data = self._dispatch()
            self.reply(status, data)
        except RemoteError as exc:
            self.reply(exc.status, {'code': exc.code})
        except (OSError, ValueError, TypeError, RecursionError):
            self.close_connection = True
            self.reply(400, {'code': 'invalid_request'})

    do_POST = do_GET
    do_PUT = do_GET
    do_DELETE = do_GET
    do_OPTIONS = do_GET
    do_HEAD = do_GET
