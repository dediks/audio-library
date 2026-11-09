import sys
from pathlib import Path

from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import audio_manager as am  # noqa: E402


def test_youtube_audio_selector_strictly_anti_drc():
    # Every tier in the selector must strictly guard against -drc streams
    tiers = am.YOUTUBE_AUDIO_SELECTOR.split("/")
    assert any("[format_id=141]" in t and "[format_id!*=-drc]" in t for t in tiers)
    assert any("[format_id=774]" in t and "[format_id!*=-drc]" in t for t in tiers)
    assert any("[format_id=251]" in t and "[format_id!*=-drc]" in t for t in tiers)
    assert any("[format_id=140]" in t and "[format_id!*=-drc]" in t for t in tiers)
    assert "ba[format_id!*=-drc]" in tiers


def test_youtube_opus_selector_prioritizes_opus_lossless():
    tiers = am.YOUTUBE_OPUS_SELECTOR.split("/")
    # Format 774 and 251 must come before 141 so Opus is stream-copied without re-encode
    idx_774 = next(i for i, t in enumerate(tiers) if "[format_id=774]" in t)
    idx_251 = next(i for i, t in enumerate(tiers) if "[format_id=251]" in t)
    idx_141 = next(i for i, t in enumerate(tiers) if "[format_id=141]" in t)
    assert idx_774 < idx_141
    assert idx_251 < idx_141


def test_build_ytdlp_command_performance_and_quality_flags(tmp_path):
    archive = tmp_path / "downloaded_ids.txt"
    cmd, desc = am.build_ytdlp_command(
        url="https://music.youtube.com/watch?v=test1234567",
        output_template="%(title)s.%(ext)s",
        archive_file=archive,
        audio_format="opus",
    )

    # Performance flags
    assert "--concurrent-fragments" in cmd
    idx_cf = cmd.index("--concurrent-fragments")
    assert cmd[idx_cf + 1] == "4"

    assert "--socket-timeout" in cmd
    assert cmd[cmd.index("--socket-timeout") + 1] == "30"

    assert "--retries" in cmd
    assert cmd[cmd.index("--retries") + 1] == "5"

    assert "--fragment-retries" in cmd
    assert cmd[cmd.index("--fragment-retries") + 1] == "5"

    # Cover art embedding only when mutagen is available
    if am.is_mutagen_available():
        assert "--embed-thumbnail" in cmd
        assert "--convert-thumbnails" in cmd
        assert cmd[cmd.index("--convert-thumbnails") + 1] == "jpg"
    else:
        assert "--embed-thumbnail" not in cmd

    # Lossless remux to .opus
    assert "--extract-audio" in cmd
    assert cmd[cmd.index("--audio-format") + 1] == "opus"

    assert "Anti-DRC: Active" in desc
    assert "Multi-thread: 4x" in desc


def test_thumbnail_guarded_by_mutagen(tmp_path):
    archive = tmp_path / "downloaded_ids.txt"
    with mock.patch.object(am, "is_mutagen_available", return_value=False):
        cmd, _ = am.build_ytdlp_command("https://youtube.com/watch?v=xyz", "out", archive, "opus")
        assert "--embed-thumbnail" not in cmd
    with mock.patch.object(am, "is_mutagen_available", return_value=True):
        cmd, _ = am.build_ytdlp_command("https://youtube.com/watch?v=xyz", "out", archive, "opus")
        assert "--embed-thumbnail" in cmd


def test_describe_format_tier():
    assert "256 kbps" in am.describe_format_tier("141")
    assert "160 kbps" in am.describe_format_tier("251")
    assert "WARNING" in am.describe_format_tier("251-drc")

