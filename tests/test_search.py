#!/usr/bin/env python3
"""Tests for YouTube Music in-app search functionality and parsing logic."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import audio_manager


def test_search_empty_or_whitespace_returns_empty():
    assert audio_manager.search_youtube_music("") == []
    assert audio_manager.search_youtube_music("   ") == []
    assert audio_manager.search_youtube_music(None) == []


def test_parse_music_responsive_item_song():
    renderer = {
        "playlistItemData": {"videoId": "testSong123"},
        "flexColumns": [
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {"runs": [{"text": "Sephia"}]}
                }
            },
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {
                        "runs": [
                            {"text": "Lagu"},
                            {"text": " • "},
                            {
                                "text": "Sheila on 7",
                                "navigationEndpoint": {
                                    "browseEndpoint": {
                                        "browseEndpointContextSupportedConfigs": {
                                            "browseEndpointContextMusicConfig": {
                                                "pageType": "MUSIC_PAGE_TYPE_ARTIST"
                                            }
                                        }
                                    }
                                }
                            },
                            {"text": " • "},
                            {
                                "text": "Kisah Klasik Untuk Masa Depan",
                                "navigationEndpoint": {
                                    "browseEndpoint": {
                                        "browseEndpointContextSupportedConfigs": {
                                            "browseEndpointContextMusicConfig": {
                                                "pageType": "MUSIC_PAGE_TYPE_ALBUM"
                                            }
                                        }
                                    }
                                }
                            },
                            {"text": " • "},
                            {"text": "4:56"}
                        ]
                    }
                }
            }
        ],
        "thumbnail": {
            "musicThumbnailRenderer": {
                "thumbnail": {
                    "thumbnails": [
                        {"url": "//lh3.googleusercontent.com/sephia.jpg"}
                    ]
                }
            }
        }
    }

    item = audio_manager._parse_music_responsive_item(renderer)
    assert item is not None
    assert item["id"] == "testSong123"
    assert item["title"] == "Sephia"
    assert item["artist"] == "Sheila on 7"
    assert item["album"] == "Kisah Klasik Untuk Masa Depan"
    assert item["duration"] == "4:56"
    assert item["thumbnail"] == "https://lh3.googleusercontent.com/sephia.jpg"
    assert item["url"] == "https://music.youtube.com/watch?v=testSong123"
    assert item["type"] == "song"


def test_parse_music_responsive_item_playlist():
    renderer = {
        "navigationEndpoint": {
            "watchEndpoint": {
                "playlistId": "PLtestPlaylist99"
            }
        },
        "flexColumns": [
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {"runs": [{"text": "Indonesian Pop 2000s"}]}
                }
            },
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {
                        "runs": [
                            {"text": "Daftar Putar"},
                            {"text": " • "},
                            {"text": "Swararia Lab"}
                        ]
                    }
                }
            }
        ],
        "thumbnail": {
            "musicThumbnailRenderer": {
                "thumbnail": {
                    "thumbnails": [
                        {"url": "https://lh3.googleusercontent.com/playlist.jpg"}
                    ]
                }
            }
        }
    }

    item = audio_manager._parse_music_responsive_item(renderer)
    assert item is not None
    assert item["id"] == "PLtestPlaylist99"
    assert item["title"] == "Indonesian Pop 2000s"
    assert item["url"] == "https://music.youtube.com/playlist?list=PLtestPlaylist99"
    assert item["type"] == "playlist"


def test_parse_music_responsive_item_playlist_track_count():
    renderer = {
        "navigationEndpoint": {
            "watchEndpoint": {
                "playlistId": "PLtestCount"
            }
        },
        "flexColumns": [
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {"runs": [{"text": "Hadrah Campursari"}]}
                }
            },
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {
                        "runs": [
                            {"text": "Daftar Putar"},
                            {"text": " • "},
                            {"text": "Official Artist"},
                            {"text": " • "},
                            {"text": "24 lagu"}
                        ]
                    }
                }
            }
        ],
        "thumbnail": {
            "musicThumbnailRenderer": {
                "thumbnail": {
                    "thumbnails": [{"url": "https://example.com/cover.jpg"}]
                }
            }
        }
    }
    item = audio_manager._parse_music_responsive_item(renderer)
    assert item is not None
    assert item["track_count"] == "24 lagu"
    assert item["type"] == "playlist"


@patch("audio_manager.urllib.request.urlopen")
def test_search_youtube_music_innertube_mock(mock_urlopen):
    sample_response = {
        "contents": {
            "tabbedSearchResultsRenderer": {
                "tabs": [{
                    "tabRenderer": {
                        "content": {
                            "sectionListRenderer": {
                                "contents": [{
                                    "musicShelfRenderer": {
                                        "contents": [
                                            {
                                                "musicResponsiveListItemRenderer": {
                                                    "playlistItemData": {"videoId": "vid1"},
                                                    "flexColumns": [
                                                        {
                                                            "musicResponsiveListItemFlexColumnRenderer": {
                                                                "text": {"runs": [{"text": "Song 1"}]}
                                                            }
                                                        },
                                                        {
                                                            "musicResponsiveListItemFlexColumnRenderer": {
                                                                "text": {"runs": [{"text": "Artist A"}, {"text": " • "}, {"text": "3:20"}]}
                                                            }
                                                        }
                                                    ]
                                                }
                                            },
                                            {
                                                "musicResponsiveListItemRenderer": {
                                                    "playlistItemData": {"videoId": "vid2"},
                                                    "flexColumns": [
                                                        {
                                                            "musicResponsiveListItemFlexColumnRenderer": {
                                                                "text": {"runs": [{"text": "Song 2"}]}
                                                            }
                                                        },
                                                        {
                                                            "musicResponsiveListItemFlexColumnRenderer": {
                                                                "text": {"runs": [{"text": "Artist B"}, {"text": " • "}, {"text": "4:10"}]}
                                                            }
                                                        }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }]
                            }
                        }
                    }
                }]
            }
        }
    }

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__.return_value = mock_resp
    mock_resp.read.return_value = json.dumps(sample_response).encode("utf-8")
    mock_urlopen.return_value = mock_resp

    results = audio_manager.search_youtube_music("Sheila on 7", search_type="songs", limit=5)
    assert len(results) == 2
    assert results[0]["id"] == "vid1"
    assert results[0]["title"] == "Song 1"
    assert results[1]["id"] == "vid2"
    assert results[1]["title"] == "Song 2"


@patch("audio_manager.urllib.request.urlopen")
@patch("audio_manager.subprocess.run")
def test_search_youtube_music_fallback_to_ytdlp(mock_subproc, mock_urlopen):
    # Simulate Innertube failure (e.g. HTTP 500 or network error)
    mock_urlopen.side_effect = Exception("Network blocked or changed")

    # Simulate yt-dlp flat-playlist json output
    ytdlp_stdout = "\n".join([
        json.dumps({
            "id": "ytdlpVid1",
            "title": "Fallback Track 1",
            "uploader": "Uploader One",
            "duration": 215,
            "thumbnails": [{"url": "https://img.youtube.com/vi/ytdlpVid1/0.jpg"}],
            "_type": "video",
        }),
        json.dumps({
            "id": "ytdlpVid2",
            "title": "Fallback Track 2",
            "uploader": "Uploader Two",
            "duration": 180,
            "thumbnails": [{"url": "https://img.youtube.com/vi/ytdlpVid2/0.jpg"}],
            "_type": "video",
        }),
    ])

    mock_proc = MagicMock()
    mock_proc.stdout = ytdlp_stdout
    mock_subproc.return_value = mock_proc

    results = audio_manager.search_youtube_music("Judika", search_type="songs", limit=2)
    assert len(results) == 2
    assert results[0]["id"] == "ytdlpVid1"
    assert results[0]["title"] == "Fallback Track 1"
    assert results[0]["artist"] == "Uploader One"
    assert results[0]["duration"] == "03:35"
    assert results[0]["url"] == "https://music.youtube.com/watch?v=ytdlpVid1"


def test_web_ui_search_handler_success():
    import web_ui

    handler = web_ui.AudioServerHandler.__new__(web_ui.AudioServerHandler)
    handler.send_json = MagicMock()

    with patch("audio_manager.search_youtube_music") as mock_search:
        mock_search.return_value = [
            {
                "id": "mockVid1",
                "title": "Dan",
                "artist": "Sheila on 7",
                "album": "",
                "duration": "4:47",
                "thumbnail": "https://lh3.googleusercontent.com/dan.jpg",
                "url": "https://music.youtube.com/watch?v=mockVid1",
                "type": "song",
            }
        ]

        handler._handle_post_search({"query": "Sheila on 7", "type": "songs", "limit": 5})

        handler.send_json.assert_called_once()
        status, resp = handler.send_json.call_args[0]
        assert status == 200
        assert resp["ok"] is True
        assert resp["count"] == 1
        assert resp["results"][0]["id"] == "mockVid1"


def test_web_ui_search_handler_empty_query_400():
    import web_ui

    handler = web_ui.AudioServerHandler.__new__(web_ui.AudioServerHandler)
    handler.send_json = MagicMock()

    handler._handle_post_search({"query": "   "})
    handler.send_json.assert_called_once()
    status, resp = handler.send_json.call_args[0]
    assert status == 400
    assert resp["ok"] is False


def test_web_ui_audio_server_handler_timeout_config():
    import web_ui

    assert web_ui.AudioServerHandler.timeout >= 60.0


def test_web_ui_suppresses_request_timed_out_log():
    import web_ui

    handler = web_ui.AudioServerHandler.__new__(web_ui.AudioServerHandler)
    handler.log_message = MagicMock()

    # Request timed out should be suppressed
    handler.log_error("Request timed out: %r", TimeoutError("timed out"))
    handler.log_message.assert_not_called()

    # Other real errors should still be logged
    handler.log_error("Broken pipe: %r", BrokenPipeError())
    handler.log_message.assert_called_once()


def test_web_ui_csp_allows_youtube_images():
    import web_ui

    handler = web_ui.AudioServerHandler.__new__(web_ui.AudioServerHandler)
    headers = {}
    handler.send_header = lambda k, v: headers.setdefault(k, v)

    handler.send_security_headers()
    csp = headers.get("Content-Security-Policy", "")
    assert "googleusercontent.com" in csp
    assert "ytimg.com" in csp


def test_youtube_music_playlist_vl_prefix_stripped():
    # 1. Parsing responsive item strips VL prefix
    renderer = {
        "navigationEndpoint": {
            "watchEndpoint": {
                "playlistId": "VLPLB-KL4AmmhmhYvJPj2w2ZIVw5VyNivBtd"
            }
        },
        "flexColumns": [
            {
                "musicResponsiveListItemFlexColumnRenderer": {
                    "text": {"runs": [{"text": "Test Playlist"}]}
                }
            }
        ]
    }
    item = audio_manager._parse_music_responsive_item(renderer)
    assert item is not None
    assert item["id"] == "PLB-KL4AmmhmhYvJPj2w2ZIVw5VyNivBtd"
    assert item["url"] == "https://music.youtube.com/playlist?list=PLB-KL4AmmhmhYvJPj2w2ZIVw5VyNivBtd"

    # 2. build_ytdlp_command normalizes URL argument
    cmd, _ = audio_manager.build_ytdlp_command(
        url="https://music.youtube.com/playlist?list=VLPLB-KL4AmmhmhYvJPj2w2ZIVw5VyNivBtd",
        output_template="out.%(ext)s",
        archive_file=Path("downloaded_ids.txt"),
    )
    assert cmd[-1] == "https://music.youtube.com/playlist?list=PLB-KL4AmmhmhYvJPj2w2ZIVw5VyNivBtd"


def test_javascript_syntax_clean():
    import shutil
    import subprocess
    node_bin = shutil.which("node")
    if not node_bin:
        return
    js_files = list(Path("static").glob("*.js")) + list(Path("static/modules").glob("*.js"))
    assert len(js_files) > 0
    for js_path in js_files:
        res = subprocess.run(
            [node_bin, "--input-type=module", "-e", f"import './{js_path.as_posix()}'"],
            capture_output=True,
            text=True,
        )
        assert "SyntaxError:" not in res.stderr, f"SyntaxError in {js_path}: {res.stderr}"


def test_format_item_subtitle_deduplication():
    import shutil
    import subprocess
    node_bin = shutil.which("node")
    if not node_bin:
        return
    script = """
    import fs from 'fs';
    const code = fs.readFileSync('static/app.js', 'utf8');
    const fnMatch = code.match(/function formatItemSubtitle[\\s\\S]*?\\n}/);
    if (!fnMatch) throw new Error('formatItemSubtitle not found');
    const fn = new Function(`${fnMatch[0]}; return formatItemSubtitle;`)();
    
    // Single release where album == title (exact or with feats/modifiers)
    if (fn({ title: 'Nyanyian Rindu', artist: 'Mahesa', album: 'Nyanyian Rindu' }) !== 'Mahesa') throw new Error('Exact match failed');
    if (fn({ title: 'Berpisah Di Ujung Jalan (feat. Mahesa Music)', artist: 'Ayu Cantika', album: 'Berpisah Di Ujung Jalan' }) !== 'Ayu Cantika') throw new Error('Feat modifier failed');
    if (fn({ title: 'Check Sound (Instrumental)', artist: 'Fariz Kendang', album: 'Check Sound (Instrumental)' }) !== 'Fariz Kendang') throw new Error('Instrumental failed');
    
    // Distinct full album
    if (fn({ title: 'Dan', artist: 'Sheila on 7', album: 'Kisah Klasik Untuk Masa Depan' }) !== 'Sheila on 7 · Kisah Klasik Untuk Masa Depan') throw new Error('Distinct album failed');
    """
    res = subprocess.run([node_bin, "--input-type=module", "-e", script], capture_output=True, text=True)
    assert res.returncode == 0, f"Node assertion failed: {res.stderr}"


if __name__ == "__main__":
    test_search_empty_or_whitespace_returns_empty()
    test_parse_music_responsive_item_song()
    test_parse_music_responsive_item_playlist()
    test_search_youtube_music_innertube_mock()
    test_search_youtube_music_fallback_to_ytdlp()
    test_web_ui_search_handler_success()
    test_web_ui_search_handler_empty_query_400()
    test_web_ui_audio_server_handler_timeout_config()
    test_web_ui_suppresses_request_timed_out_log()
    test_web_ui_csp_allows_youtube_images()
    print("All search tests passed successfully!")

