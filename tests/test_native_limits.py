"""Native v1 delivery cancellation, resource bounds and request-log privacy."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_revocation_and_role_downgrade_cancel_queued_and_pending_commands():
    from web_ui import RemotePlayerHub
    from secure_remote import SecureRemote, RemoteError
    hub = RemotePlayerHub()
    remote = SecureRemote(hub)
    remote.activate()
    pair = remote.pair(remote.open_invite(), 'Operator')
    remote.approve(pair['device_id'], 'control')
    remote.master_poll({'is_playing': True}, [], 'master-instance-one')
    queued = remote.command(pair['token'], 'stop', 'request-queued')
    pending = remote.command(pair['token'], 'pause', 'request-pending')
    # Simulate only one command handed to a consumer before disconnect.
    with hub.lock:
        work = list(hub.command_queue)
        hub.command_queue.clear()
    remote.master_exchange([work[1]], [])
    remote.revoke(pair['device_id'])
    assert remote.records[queued['command_id']]['status'] == 'rejected'
    assert remote.records[pending['command_id']]['status'] == 'unknown'
    assert remote.master_exchange([work[0]], []) == []
    remote.master_exchange([], [{'command_id': pending['command_id'], 'status': 'applied', 'observed': {'is_playing': False}}])
    assert remote.records[pending['command_id']]['status'] == 'unknown'
    assert hub.master_state['is_playing'] is True
    pair = remote.pair(remote.open_invite(), 'Viewer')
    remote.approve(pair['device_id'], 'control')
    queued = remote.command(pair['token'], 'stop', 'request-downgrade')
    remote.approve(pair['device_id'], 'view_only')
    assert remote.records[queued['command_id']]['status'] == 'rejected'


def test_admin_snapshot_marks_session_expired_without_token_poll():
    from web_ui import RemotePlayerHub
    from secure_remote import SecureRemote, RemoteError
    now = [time.time()]
    remote = SecureRemote(RemotePlayerHub(), clock=lambda: now[0])
    remote.activate()
    pair = remote.pair(remote.open_invite(), 'HP')
    remote.approve(pair['device_id'], 'control')
    now[0] += remote.SESSION_TTL + 1
    assert remote.admin_status()['devices'][0]['status'] == 'expired'
    try:
        remote.session(pair['token'])
        assert False
    except RemoteError as exc:
        assert exc.code == 'expired'
    remote.stop()
    try:
        remote.session(pair['token'])
        assert False
    except RemoteError as exc:
        assert exc.code == 'disabled'


def test_local_request_logging_never_includes_raw_remote_request():
    import contextlib
    import io
    from web_ui import AudioServerHandler
    handler = AudioServerHandler.__new__(AudioServerHandler)
    handler.path = '/api/native-remote?token=fixture-not-secret'
    output = io.StringIO()
    with contextlib.redirect_stderr(output):
        handler.log_message('"%s" %s', 'GET /api/native-remote?token=fixture-not-secret HTTP/1.1', 404)
    assert 'fixture-not-secret' not in output.getvalue()


def test_master_reopen_and_heartbeat_gap_never_replay_queued_work():
    from web_ui import RemotePlayerHub
    from secure_remote import SecureRemote
    now = [time.time()]
    hub = RemotePlayerHub()
    remote = SecureRemote(hub, clock=lambda: now[0])
    remote.activate()
    remote.master_poll({'is_playing': False}, [], 'master-instance-one')
    pair = remote.pair(remote.open_invite(), 'HP')
    remote.approve(pair['device_id'], 'control')
    command = remote.command(pair['token'], 'play', 'request-before-reopen')
    assert remote.master_poll({'is_playing': False}, [], 'master-instance-two') == []
    assert remote.command_status(pair['token'], command['command_id'])['status'] == 'rejected'
    command = remote.command(pair['token'], 'play', 'request-before-gap')
    now[0] += 2.5  # Less than command TTL, but the master was already unavailable.
    assert remote.master_poll({'is_playing': False}, [], 'master-instance-two') == []
    assert remote.command_status(pair['token'], command['command_id'])['status'] == 'rejected'


def test_consumer_claim_rechecks_device_permission_and_master_before_execution():
    from web_ui import RemotePlayerHub
    from secure_remote import SecureRemote
    remote = SecureRemote(RemotePlayerHub())
    remote.activate()
    remote.master_poll({'is_playing': False}, [], 'master-instance-one')
    pair = remote.pair(remote.open_invite(), 'HP')
    remote.approve(pair['device_id'], 'control')
    command = remote.command(pair['token'], 'play', 'request-before-claim')
    work = remote.master_poll({'is_playing': False}, [], 'master-instance-one')
    assert len(work) == 1
    assert remote.claim(command['command_id'], 'master-instance-one')['authorized'] is True
    assert remote.claim(command['command_id'], 'wrong-master-instance')['authorized'] is False
    remote.approve(pair['device_id'], 'view_only')
    assert remote.claim(command['command_id'], 'master-instance-one')['authorized'] is False
    assert remote.hub.master_state['is_playing'] is False


def test_packaging_manifest_includes_session_tls_runtime():
    import ast
    root = Path(__file__).resolve().parents[1]
    requirements = (root / 'requirements.txt').read_text()
    assert 'cryptography==50.0.2' in requirements
    spec = (root / 'SwarariaAudioLab.spec').read_text()
    ast.parse(spec)
    assert '"secure_remote"' in spec and '"secure_remote_tls"' in spec
    assert 'collect_all("cryptography")' in spec
