#!/usr/bin/env python3
"""Tests for GitHub update checker & semver parsing logic."""
from unittest.mock import MagicMock, patch

import web_ui


def test_parse_semver():
    assert web_ui._parse_semver("1.0.0") == (1, 0, 0)
    assert web_ui._parse_semver("v1.0.1") == (1, 0, 1)
    assert web_ui._parse_semver("V2.10.4-beta") == (2, 10, 4)
    assert web_ui._parse_semver("") == (0,)

    # Version comparisons
    assert web_ui._parse_semver("v1.0.1") > web_ui._parse_semver("1.0.0")
    assert web_ui._parse_semver("v1.1.0") > web_ui._parse_semver("1.0.9")
    assert web_ui._parse_semver("v2.0.0") > web_ui._parse_semver("1.9.9")
    assert not (web_ui._parse_semver("1.0.0") > web_ui._parse_semver("v1.0.0"))
    assert not (web_ui._parse_semver("0.9.9") > web_ui._parse_semver("1.0.0"))


def test_install_update_package_url_validation():
    # Strict URL validation rejects external or malicious URLs
    ok, msg = web_ui.install_update_package("https://evil.com/malicious.exe")
    assert not ok
    assert "URL unduhan tidak sah" in msg

    ok, msg = web_ui.install_update_package("javascript:alert(1)")
    assert not ok


@patch("web_ui.urlopen")
def test_check_for_updates_mock_release(mock_urlopen):
    mock_resp = MagicMock()
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.read.return_value = b"""{
        "tag_name": "v1.1.0",
        "name": "Swararia Audio Lab v1.1.0",
        "body": "Fitur baru: Cek Update Otomatis",
        "html_url": "https://github.com/dediks/audio-library/releases/tag/v1.1.0",
        "published_at": "2026-11-10T06:00:00Z",
        "assets": [
            {
                "name": "SwarariaAudioLab_Setup.exe",
                "browser_download_url": "https://github.com/dediks/audio-library/releases/download/v1.1.0/SwarariaAudioLab_Setup.exe",
                "size": 168000000
            }
        ]
    }"""
    mock_urlopen.return_value = mock_resp

    res = web_ui.check_for_updates()
    assert res["ok"]
    assert res["has_update"]
    assert res["latest_version"] == "v1.1.0"
    assert res["download_url"] == "https://github.com/dediks/audio-library/releases/download/v1.1.0/SwarariaAudioLab_Setup.exe"


if __name__ == "__main__":
    test_parse_semver()
    test_install_update_package_url_validation()
    test_check_for_updates_mock_release()
    print("All update checker tests passed!")
