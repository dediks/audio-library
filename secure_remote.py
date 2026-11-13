"""Session-only native remote v1. No media, filesystem or discovery API.

Owned by the local HTTP server. Secrets exist only in RAM; TLS key material is
created in a private temporary directory and removed immediately after loading.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import time


class RemoteError(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status
        super().__init__(code)


MAX_CATALOG_BYTES = 98_304


def encode_remote_json(data):
    """One serialization policy for catalog budgeting and the actual TLS reply."""
    return json.dumps(data, allow_nan=False).encode('utf-8')


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
    MAX_TRACKS = 250
    MAX_GROUPS = 64
    TRACK_ID_RE = re.compile(r'^[A-Za-z0-9_-]{3,32}$')
    GROUP_ID_RE = re.compile(r'^[A-Za-z0-9_-]{2,32}$')
    ALLOWED_ACTIONS = ('play', 'pause', 'stop', 'fade_out', 'prev', 'next', 'select_track', 'select_group')

    def __init__(self, hub, clock=time.time):
        self.hub, self.clock = hub, clock
        self.lock = threading.RLock()
        self.enabled = False
        self.session_id = None
        self.invite = None
        self.devices = {}
        self.records = {}
        self.catalog_tracks = []
        self.track_ids = set()
        self.catalog_groups = []
        self.group_ids = set()
        self.active_group_id = None
        self.total_tracks = 0
        self.current_track_id = None
        self.playlist_label = None
        self.catalog_version = 0
        self.tracks_synced = False
        self.master_instance = None
        self.master_seen = 0
        self.listener = None
        self.listener_thread = None
        self.certificate = None
        self.connection_info = {}
        self.bind_info = {}
        self.lifecycle_lock = threading.Lock()

    def start(self, host, port=8766, advertise_ip=None, advertise_port=None):
        """Start the local mTLS/HTTPS remote listener, optionally advertising a bridged public endpoint."""
        from secure_remote_tls import NativeTLSServer, tls_context, validate_bind
        validate_bind(host, port)
        public_ip = host if advertise_ip is None else advertise_ip
        if advertise_ip is not None or advertise_port is not None:
            public_check_port = port if advertise_port is None else advertise_port
            validate_bind(public_ip, public_check_port)
        with self.lifecycle_lock:
            if self.listener:
                raise RemoteError('already_enabled', 409)
            try:
                extra_ips = (public_ip,) if public_ip != host else ()
                context, certificate, fingerprint = tls_context(host, extra_ips=extra_ips)
                listener = NativeTLSServer((host, port), self, context)
            except (OSError, ValueError):
                raise RemoteError('listener_unavailable', 409) from None
            self.activate()
            self.certificate = certificate
            actual_bind_port = listener.server_address[1]
            actual_public_port = actual_bind_port if advertise_port is None else advertise_port
            self.bind_info = {'ip': host, 'port': actual_bind_port}
            self.connection_info = {'url': f'https://{public_ip}:{actual_public_port}',
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
            self.bind_info = {}
            self.certificate = None

    def activate(self):
        with self.lock:
            self.enabled = True
            self.session_id = secrets.token_urlsafe(24)
            self.devices.clear()
            self.records.clear()
            self._clear_catalog()
            self._discard_queue()
            self.invite = None

    def deactivate(self):
        with self.lock:
            self.enabled = False
            self.invite = None
            self.devices.clear()
            self.records.clear()
            self._clear_catalog()
            self._discard_queue()
            self.session_id = None

    def _clear_catalog(self):
        self.catalog_tracks = []
        self.track_ids = set()
        self.catalog_groups = []
        self.group_ids = set()
        self.active_group_id = None
        self.total_tracks = 0
        self.current_track_id = None
        self.playlist_label = None
        self.tracks_synced = False

    @staticmethod
    def _sanitize_title(raw, max_len=160):
        if not isinstance(raw, str) or '://' in raw:
            return None
        title = re.split(r'[/\\]', raw)[-1]
        title = ''.join(c for c in title if c.isprintable()).strip()
        # Android (including released v1 clients) bounds strings in UTF-16 units.
        # Dropping an incomplete final pair keeps whole Unicode scalar values.
        return title.encode('utf-16-le')[:max_len * 2].decode('utf-16-le', errors='ignore') or None

    def _update_catalog(self, catalog):
        if not isinstance(catalog, dict):
            return
        raw_items = catalog.get('items')
        if not isinstance(raw_items, list):
            return
        sanitized_groups = []
        seen_group_ids = set()
        raw_groups = catalog.get('groups')
        if isinstance(raw_groups, list):
            for entry in raw_groups[:self.MAX_GROUPS]:
                if not isinstance(entry, dict):
                    continue
                gid = entry.get('id')
                if not isinstance(gid, str) or not self.GROUP_ID_RE.fullmatch(gid) or gid in seen_group_ids:
                    continue
                name = self._sanitize_title(entry.get('name'), max_len=60)
                if not name:
                    continue
                raw_count = entry.get('count', 0)
                count = raw_count if (type(raw_count) is int and raw_count >= 0) else 0
                seen_group_ids.add(gid)
                sanitized_groups.append({'id': gid, 'name': name, 'count': min(count, 100000)})
        sanitized = []
        seen_ids = set()
        for item in raw_items[:self.MAX_TRACKS]:
            if not isinstance(item, dict):
                continue
            tid = item.get('id')
            if not isinstance(tid, str) or not self.TRACK_ID_RE.fullmatch(tid) or tid in seen_ids:
                continue
            title = self._sanitize_title(item.get('title'), max_len=140)
            if not title:
                continue
            seen_ids.add(tid)
            entry = {'id': tid, 'title': title}
            item_gid = item.get('group_id')
            if isinstance(item_gid, str) and item_gid in seen_group_ids:
                entry['group_id'] = item_gid
            sanitized.append(entry)
        self.catalog_groups = sanitized_groups
        self.group_ids = seen_group_ids
        raw_active_group = catalog.get('active_group_id')
        self.active_group_id = raw_active_group if (isinstance(raw_active_group, str) and raw_active_group in seen_group_ids) else None
        raw_total = catalog.get('total_tracks')
        self.total_tracks = min(raw_total, 100000) if (type(raw_total) is int and raw_total >= len(sanitized)) else len(sanitized)
        self.catalog_tracks = sanitized
        self.track_ids = seen_ids
        self.playlist_label = self._sanitize_title(catalog.get('playlist'), max_len=60)
        if self.current_track_id not in self.track_ids:
            self.current_track_id = None
        self.catalog_version += 1
        self.tracks_synced = True

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

    def command(self, token, action, key, track_id=None, auto_play=False, group_id=None):
        with self.lock:
            d = self._device(token, active=True, control=True)
            if action not in self.ALLOWED_ACTIONS or not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,80}', key):
                raise RemoteError('invalid_command', 400)
            if action == 'select_track':
                if not isinstance(track_id, str) or not self.TRACK_ID_RE.fullmatch(track_id) or type(auto_play) is not bool or group_id is not None:
                    raise RemoteError('invalid_command', 400)
                cmd_params = {'track_id': track_id, 'auto_play': auto_play}
            elif action == 'select_group':
                if not isinstance(group_id, str) or not self.GROUP_ID_RE.fullmatch(group_id) or track_id is not None or auto_play:
                    raise RemoteError('invalid_command', 400)
                cmd_params = {'group_id': group_id}
            else:
                if track_id is not None or auto_play or group_id is not None:
                    raise RemoteError('invalid_command', 400)
                cmd_params = {}
            self._prune_records()
            for r in self.records.values():
                if r['device_id'] == d['device_id'] and r['key'] == key:
                    if (r['action'] != action or r.get('track_id') != track_id or
                            bool(r.get('auto_play', False)) != bool(auto_play) or
                            r.get('group_id') != group_id):
                        raise RemoteError('idempotency_conflict', 409)
                    return self._result(r)
            if len(self.records) >= self.MAX_RECORDS:
                raise RemoteError('command_limit', 429)
            online = self.master_instance is not None and self.clock() - self.master_seen < 2.0
            if not online:
                raise RemoteError('master_unavailable', 409)
            if action == 'select_track' and track_id not in self.track_ids:
                raise RemoteError('unknown_track', 409)
            if action == 'select_group' and group_id not in self.group_ids:
                raise RemoteError('unknown_group', 409)
            cid = secrets.token_urlsafe(18)
            now = self.clock()
            r = {'command_id': cid, 'device_id': d['device_id'], 'key': key,
                 'action': action, 'track_id': track_id, 'auto_play': bool(auto_play),
                 'group_id': group_id, 'status': 'accepted', 'created_at': now, 'expires_at': now + self.COMMAND_TTL}
            self.records[cid] = r
            # Reuse the existing hub queue; mark within its lock before any poll.
            with self.hub.lock:
                cmd = {'id': self.hub.next_cmd_id, 'native_id': cid, 'action': action,
                       'params': cmd_params, 'client_id': d['device_id'], 'created_at': now,
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

    def tracks(self, token):
        with self.lock:
            self._device(token, active=True)
            online = self.master_instance is not None and self.clock() - self.master_seen < 2.0
            current = self.current_track_id if (online and self.current_track_id in self.track_ids) else None
            payload = {
                'protocol': 'v1',
                'master_online': online,
                'catalog_version': self.catalog_version,
                'playlist': self.playlist_label if online else None,
                'active_group_id': self.active_group_id if online else None,
                'total_tracks': self.total_tracks if online else 0,
                'groups': list(self.catalog_groups) if online else [],
                'current_track_id': current,
                'tracks': list(self.catalog_tracks) if online else [],
            }
            # Fixed bounded metadata and at most 64 bounded groups fit on their
            # own. Select the largest deterministic track prefix fitting the
            # *actual* reply encoding, without changing total_tracks or IDs used
            # for command validation. The current ID may be outside that prefix.
            if len(encode_remote_json(payload)) > MAX_CATALOG_BYTES:
                tracks = payload['tracks']
                low, high = 0, len(tracks)
                while low < high:
                    mid = (low + high + 1) // 2
                    payload['tracks'] = tracks[:mid]
                    if len(encode_remote_json(payload)) <= MAX_CATALOG_BYTES:
                        low = mid
                    else:
                        high = mid - 1
                payload['tracks'] = tracks[:low]
            return payload

    def state(self, token):
        with self.lock:
            d = self._device(token, active=True)
            with self.hub.lock:
                state = self.hub.master_state
                # Only bounded display text; never forward track paths, URLs or QC.
                snapshot = {k: state.get(k) for k in ('is_playing', 'transport_state', 'current_time', 'duration')}
                track = state.get('track')
                title = self._sanitize_title(track.get('name') if isinstance(track, dict) else None, max_len=160)
                snapshot['track_title'] = title
                online = self.master_instance is not None and self.clock() - self.master_seen < 2.0
            return {'protocol': 'v1', 'role': d['role'], 'master_online': online, 'state': snapshot}

    def master_poll(self, state, acknowledgements, instance, catalog=None):
        with self.lock:
            if not isinstance(instance, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', instance) or not isinstance(state, dict) or not state:
                raise RemoteError('invalid_master_state', 400)
            # A new page (or a poll gap) is not permission to replay old work.
            if self.master_instance != instance or self.clock() - self.master_seen >= 2.0:
                for d in self.devices.values():
                    self._cancel_device_commands(d['device_id'])
                self._clear_catalog()
            self.master_instance = instance
            self.master_seen = self.clock()
            if catalog is not None:
                self._update_catalog(catalog)
            if 'native_track_id' in state:
                tid = state.get('native_track_id')
                self.current_track_id = tid if (isinstance(tid, str) and tid in self.track_ids) else None
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
                    if r['action'] == 'play':
                        matches = observed.get('is_playing') is True
                    elif r['action'] == 'stop':
                        matches = (observed.get('is_playing') is False and
                                   observed.get('transport_state') == 'STOPPED' and
                                   observed.get('current_time') == 0)
                    elif r['action'] == 'fade_out':
                        matches = (observed.get('transport_state') == 'FADING' and
                                   observed.get('is_playing') is True)
                    elif r['action'] == 'select_track':
                        matches = (observed.get('track_id') == r.get('track_id') and
                                   (observed.get('is_playing') is True if r.get('auto_play')
                                    else observed.get('is_playing') is False))
                        if matches and isinstance(r.get('track_id'), str):
                            self.current_track_id = r['track_id']
                    elif r['action'] == 'select_group':
                        matches = observed.get('active_group_id') == r.get('group_id')
                        if matches and isinstance(r.get('group_id'), str):
                            self.active_group_id = r['group_id']
                    elif r['action'] in ('prev', 'next'):
                        tid = observed.get('track_id')
                        matches = (isinstance(tid, str) and bool(self.TRACK_ID_RE.fullmatch(tid)) and
                                   isinstance(observed.get('is_playing'), bool))
                        if matches:
                            self.current_track_id = tid
                    else:
                        matches = observed.get('is_playing') is False
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
            status = {'enabled': self.enabled, 'protocol': 'v1', **self.connection_info,
                      'invite': self.invite[0] if self.invite else None,
                      'invite_expires_at': self.invite[1] if self.invite else None,
                      'devices': [{k: d[k] for k in ('device_id', 'label', 'status', 'role', 'expires_at')}
                                  for d in self.devices.values()]}
            if self.enabled and self.bind_info:
                bind_url = f"https://{self.bind_info['ip']}:{self.bind_info['port']}"
                if bind_url != self.connection_info.get('url'):
                    status['bind_url'] = bind_url
            return status
