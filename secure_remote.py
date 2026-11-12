"""Session-only native remote v1. No media, filesystem or discovery API.

Owned by the local HTTP server. Secrets exist only in RAM; TLS key material is
created in a private temporary directory and removed immediately after loading.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time


class RemoteError(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status
        super().__init__(code)


def _digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


class SecureRemote:
    INVITE_TTL = 90
    PENDING_TTL = 120
    SESSION_TTL = 8 * 3600
    MAX_DEVICES = 32
    COMMAND_TTL = 4
    RECORD_TTL = 300
    MAX_RECORDS = 256

    def __init__(self, hub, clock=time.time):
        self.hub, self.clock = hub, clock
        self.lock = threading.RLock()
        self.enabled = False
        self.session_id = None
        self.invite = None
        self.devices = {}
        self.records = {}
        self.master_instance = None
        self.master_seen = 0
        self.listener = None
        self.listener_thread = None
        self.certificate = None
        self.connection_info = {}
        self.lifecycle_lock = threading.Lock()

    def start(self, host, port=8766):
        from secure_remote_tls import NativeTLSServer, tls_context, validate_bind
        validate_bind(host, port)
        with self.lifecycle_lock:
            if self.listener:
                raise RemoteError('already_enabled', 409)
            try:
                context, certificate, fingerprint = tls_context(host)
                listener = NativeTLSServer((host, port), self, context)
            except (OSError, ValueError):
                raise RemoteError('listener_unavailable', 409) from None
            self.activate()
            self.certificate = certificate
            self.connection_info = {'url': f'https://{host}:{listener.server_address[1]}',
                                    'fingerprint_sha256': fingerprint}
            self.listener = listener
            self.listener_thread = threading.Thread(target=listener.serve_forever,
                                                    kwargs={'poll_interval': 0.05}, daemon=True)
            self.listener_thread.start()

    def stop(self):
        with self.lifecycle_lock:
            self.deactivate()
            if self.listener:
                self.listener.shutdown()
                self.listener.server_close()
                self.listener_thread.join(timeout=4)
                self.listener = self.listener_thread = None
            self.connection_info = {}
            self.certificate = None

    def activate(self):
        with self.lock:
            self.enabled = True
            self.session_id = secrets.token_urlsafe(24)
            self.devices.clear()
            self.records.clear()
            self._discard_queue()
            self.invite = None

    def deactivate(self):
        with self.lock:
            self.enabled = False
            self.invite = None
            self.devices.clear()
            self.records.clear()
            self._discard_queue()
            self.session_id = None

    def _enabled(self):
        if not self.enabled:
            raise RemoteError('disabled')

    def open_invite(self):
        with self.lock:
            self._enabled()
            self.invite = (secrets.token_urlsafe(32), self.clock() + self.INVITE_TTL)
            return self.invite[0]

    def close_invite(self):
        with self.lock:
            self.invite = None

    def pair(self, invite, label):
        with self.lock:
            self._enabled()
            if (not isinstance(invite, str) or not self.invite or
                    self.clock() >= self.invite[1] or
                    not secrets.compare_digest(invite, self.invite[0])):
                raise RemoteError('invalid_invite', 401)
            if not isinstance(label, str) or not 1 <= len(label) <= 80:
                raise RemoteError('invalid_label', 400)
            if len(self.devices) >= self.MAX_DEVICES:
                raise RemoteError('device_limit', 429)
            self.invite = None
            token = secrets.token_urlsafe(32)
            device = {'device_id': secrets.token_urlsafe(18), 'label': label,
                      'status': 'pending', 'role': None,
                      'expires_at': self.clock() + self.PENDING_TTL,
                      'token_hash': _digest(token)}
            self.devices[device['device_id']] = device
            return {'device_id': device['device_id'], 'token': token, 'status': 'pending'}

    def _device(self, token, active=False, control=False):
        self._enabled()
        if not isinstance(token, str) or not 20 <= len(token) <= 128:
            raise RemoteError('unauthorized', 401)
        hashed = _digest(token)
        device = next((d for d in self.devices.values()
                       if secrets.compare_digest(d['token_hash'], hashed)), None)
        if device is None:
            raise RemoteError('unauthorized', 401)
        if self.clock() >= device['expires_at']:
            device['status'] = 'expired'
        if device['status'] in ('revoked', 'denied', 'expired'):
            raise RemoteError(device['status'])
        if active and device['status'] != 'active':
            raise RemoteError('pending')
        if control and device['role'] != 'control':
            raise RemoteError('view_only')
        return device

    def session(self, token):
        with self.lock:
            d = self._device(token)
            return {k: d[k] for k in ('device_id', 'status', 'role', 'expires_at')}

    def approve(self, device_id, role):
        with self.lock:
            self._enabled()
            if role not in ('control', 'view_only'):
                raise RemoteError('invalid_role', 400)
            d = self.devices.get(device_id)
            if not d or d['status'] not in ('pending', 'active') or self.clock() >= d['expires_at']:
                raise RemoteError('unknown_device', 404)
            if role == 'view_only':
                self._cancel_device_commands(device_id)
            d.update(status='active', role=role, expires_at=self.clock() + self.SESSION_TTL)

    def revoke(self, device_id, deny=False):
        with self.lock:
            d = self.devices.get(device_id)
            if not d:
                raise RemoteError('unknown_device', 404)
            d['status'] = 'denied' if deny else 'revoked'
            self._cancel_device_commands(device_id)

    def _cancel_device_commands(self, device_id):
        for record in self.records.values():
            if record['device_id'] == device_id:
                if record['status'] == 'accepted':
                    record['status'] = 'rejected'
                elif record['status'] == 'pending':
                    record['status'] = 'unknown'
        with self.hub.lock:
            self.hub.command_queue = [c for c in self.hub.command_queue
                                      if not (c.get('native_id') and c.get('client_id') == device_id)]

    def _discard_queue(self):
        with self.hub.lock:
            self.hub.command_queue = [c for c in self.hub.command_queue if not c.get('native_id')]

    def _prune_records(self):
        now = self.clock()
        for cid, r in list(self.records.items()):
            if now >= r['expires_at'] and r['status'] in ('accepted', 'pending'):
                r['status'] = 'expired' if r['status'] == 'accepted' else 'unknown'
            if now >= r['created_at'] + self.RECORD_TTL:
                del self.records[cid]

    @staticmethod
    def _result(r):
        return {k: r[k] for k in ('command_id', 'action', 'status', 'expires_at')}

    def command(self, token, action, key):
        with self.lock:
            d = self._device(token, active=True, control=True)
            if action not in ('play', 'pause', 'stop') or not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', key):
                raise RemoteError('invalid_command', 400)
            self._prune_records()
            for r in self.records.values():
                if r['device_id'] == d['device_id'] and r['key'] == key:
                    if r['action'] != action:
                        raise RemoteError('idempotency_conflict', 409)
                    return self._result(r)
            if len(self.records) >= self.MAX_RECORDS:
                raise RemoteError('command_limit', 429)
            online = self.master_instance is not None and self.clock() - self.master_seen < 2.0
            if not online:
                raise RemoteError('master_unavailable', 409)
            cid = secrets.token_urlsafe(18)
            now = self.clock()
            r = {'command_id': cid, 'device_id': d['device_id'], 'key': key,
                 'action': action, 'status': 'accepted', 'created_at': now,
                 'expires_at': now + self.COMMAND_TTL}
            self.records[cid] = r
            # Reuse the existing hub queue; mark within its lock before any poll.
            with self.hub.lock:
                cmd = {'id': self.hub.next_cmd_id, 'native_id': cid, 'action': action,
                       'params': {}, 'client_id': d['device_id'], 'created_at': now,
                       'expires_at': r['expires_at']}
                self.hub.next_cmd_id += 1
                self.hub.command_queue.append(cmd)
            return self._result(r)

    def command_status(self, token, cid):
        with self.lock:
            d = self._device(token, active=True)
            self._prune_records()
            r = self.records.get(cid)
            if not r or r['device_id'] != d['device_id']:
                return {'command_id': cid, 'status': 'unknown'}
            return self._result(r)

    def state(self, token):
        with self.lock:
            d = self._device(token, active=True)
            with self.hub.lock:
                state = self.hub.master_state
                # Only bounded display text; never forward track paths, URLs or QC.
                snapshot = {k: state.get(k) for k in ('is_playing', 'transport_state', 'current_time', 'duration')}
                track = state.get('track')
                title = track.get('name') if isinstance(track, dict) else None
                if isinstance(title, str) and '://' not in title:
                    title = re.split(r'[/\\]', title)[-1]
                    title = ''.join(c for c in title if c.isprintable()).strip()[:160] or None
                else:
                    title = None
                snapshot['track_title'] = title
                online = self.master_instance is not None and self.clock() - self.master_seen < 2.0
            return {'protocol': 'v1', 'role': d['role'], 'master_online': online, 'state': snapshot}

    def master_poll(self, state, acknowledgements, instance):
        with self.lock:
            if not isinstance(instance, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', instance) or not isinstance(state, dict) or not state:
                raise RemoteError('invalid_master_state', 400)
            # A new page (or a poll gap) is not permission to replay old work.
            if self.master_instance != instance or self.clock() - self.master_seen >= 2.0:
                for d in self.devices.values():
                    self._cancel_device_commands(d['device_id'])
            self.master_instance = instance
            self.master_seen = self.clock()
            queue, *_ = self.hub.update_master_state(state)
            return self.master_exchange(queue, acknowledgements)

    def claim(self, cid, instance):
        """Last local authorization check, immediately before the JS consumer acts."""
        with self.lock:
            self._prune_records()
            r = self.records.get(cid) if isinstance(cid, str) else None
            d = self.devices.get(r['device_id']) if r else None
            allowed = bool(self.enabled and r and r['status'] == 'pending' and d and
                           d['status'] == 'active' and d['role'] == 'control' and
                           self.clock() < d['expires_at'] and instance == self.master_instance and
                           self.clock() - self.master_seen < 2.0)
            return {'authorized': allowed}

    def master_exchange(self, queue, acknowledgements):
        with self.lock:
            self._prune_records()
            for ack in acknowledgements[:64] if isinstance(acknowledgements, list) else []:
                if not isinstance(ack, dict):
                    continue
                r = self.records.get(ack.get('command_id'))
                if not r or r['status'] != 'pending':
                    continue
                observed = ack.get('observed')
                if ack.get('status') == 'rejected':
                    r['status'] = 'rejected'
                elif ack.get('status') == 'applied' and isinstance(observed, dict):
                    matches = (observed.get('is_playing') is True if r['action'] == 'play'
                               else observed.get('is_playing') is False)
                    if r['action'] == 'stop':
                        matches = matches and observed.get('transport_state') == 'STOPPED' and observed.get('current_time') == 0
                    if matches:
                        r['status'] = 'applied'
            deliver = []
            for cmd in queue:
                if not cmd.get('native_id'):
                    deliver.append(cmd)
                    continue
                r = self.records.get(cmd['native_id'])
                if not r or r['status'] != 'accepted':
                    continue
                d = self.devices.get(r['device_id'])
                if (not self.enabled or not d or d['status'] != 'active' or
                        d['role'] != 'control' or self.clock() >= d['expires_at']):
                    r['status'] = 'rejected'
                    continue
                r['status'] = 'pending'
                deliver.append(cmd)
            return deliver

    def admin_status(self):
        with self.lock:
            if self.invite and self.clock() >= self.invite[1]:
                self.invite = None
            for d in self.devices.values():
                if d['status'] in ('pending', 'active') and self.clock() >= d['expires_at']:
                    d['status'] = 'expired'
                    self._cancel_device_commands(d['device_id'])
            return {'enabled': self.enabled, 'protocol': 'v1', **self.connection_info,
                    'invite': self.invite[0] if self.invite else None,
                    'invite_expires_at': self.invite[1] if self.invite else None,
                    'devices': [{k: d[k] for k in ('device_id', 'label', 'status', 'role', 'expires_at')}
                                for d in self.devices.values()]}
