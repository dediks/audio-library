"""Native display metadata must not leak local paths or unrelated library data."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_state_has_bounded_track_title_without_paths_or_library_metadata():
    from secure_remote import SecureRemote
    from web_ui import RemotePlayerHub
    remote = SecureRemote(RemotePlayerHub(), clock=lambda: 1000.0)
    remote.activate()
    pair = remote.pair(remote.open_invite(), 'Display test')
    remote.approve(pair['device_id'], 'view_only')
    cases = [
        ('Intro.wav', 'Intro.wav'),
        (r'C:\private\event\Intro.wav', 'Intro.wav'),
        ('/private/event/Intro.wav', 'Intro.wav'),
        ('A\x00B\n.wav', 'AB.wav'),
        ('a' * 300, 'a' * 160),
        ('https://example.invalid/audio?credential=private', None),
        (None, None),
    ]
    for name, expected in cases:
        remote.master_poll({'track': {'name': name, 'rel_path': 'private/source',
                                     'folder': 'private', 'qc': {'private': True}},
                            'is_playing': False, 'duration': 10, 'current_time': 0,
                            'source_dir': 'private/source'}, [], 'master-title-instance')
        state = remote.state(pair['token'])['state']
        assert 'track_title' in state, 'Remote status must include safe display title'
        assert state['track_title'] == expected
        assert 'track' not in state and 'source_dir' not in state
        assert set(state) == {'track_title', 'is_playing', 'transport_state', 'current_time', 'duration'}
    remote.master_poll({'track': None, 'is_playing': False}, [], 'master-title-instance')
    assert remote.state(pair['token'])['state']['track_title'] is None
    remote.deactivate()
