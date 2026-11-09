import contextlib
import shutil
import sys
import tempfile
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import fs_browser as fb  # noqa: E402


def test_clean_basic_numbering():
    assert fb.clean_and_number_filename("Song [dQw4w9WgXcQ].mp3", index=1) == "01 - Song.mp3"


def test_clean_strips_junk_tags():
    out = fb.clean_and_number_filename("Artist - Title (Official Video).mp3", index=3)
    assert out == "03 - Artist - Title.mp3"


def test_clean_keep_yt_id():
    out = fb.clean_and_number_filename("Song [dQw4w9WgXcQ].mp3", index=1, strip_yt_id=False)
    assert out == "01 - Song [dQw4w9WgXcQ].mp3"


def test_clean_dot_mode_and_replace_old_number():
    assert fb.clean_and_number_filename("07 - Song.mp3", index=2, numbering_mode="dot") == "02. Song.mp3"


def _setup(tmp_path, names):
    for n in names:
        (tmp_path / n).write_bytes(b"x")
    stack = contextlib.ExitStack()
    stack.enter_context(mock.patch.object(fb, "get_allowed_roots", return_value=[tmp_path.resolve()]))
    # Never touch the real library/rename_history.json from tests
    hist_dir = tempfile.mkdtemp(prefix="rename_hist_")
    stack.callback(shutil.rmtree, hist_dir, True)
    stack.enter_context(mock.patch.object(fb, "RENAME_HISTORY_FILE", Path(hist_dir) / "rename_history.json"))
    return stack


def test_batch_rename_swap_numbers(tmp_path):
    with _setup(tmp_path, ["02 - A.mp3", "01 - B.mp3"]):
        ok, _msg, plan = fb.batch_rename_entries(tmp_path, ["02 - A.mp3", "01 - B.mp3"])
    assert ok
    assert all(i["applied"] for i in plan if i["changed"])
    assert sorted(p.name for p in tmp_path.iterdir()) == ["01 - A.mp3", "02 - B.mp3"]


def test_batch_rename_rolls_back_when_stage_fails(tmp_path):
    names = ["a.mp3", "b.mp3", "c.mp3"]
    real_rename = Path.rename
    calls = {"n": 0}

    def flaky(self, target):
        calls["n"] += 1
        if calls["n"] == 3:
            raise OSError("boom")
        return real_rename(self, target)

    with _setup(tmp_path, names), mock.patch.object(Path, "rename", flaky):
        ok, msg, _plan = fb.batch_rename_entries(tmp_path, names)
    assert not ok
    assert "rolled back" in msg
    assert sorted(p.name for p in tmp_path.iterdir()) == names



def test_ambiguous_word_after_dash_is_kept():
    assert fb.clean_and_number_filename("Song - OST Remix.mp3", index=1) == "01 - Song - OST Remix.mp3"
    assert fb.clean_and_number_filename("Artist - HD Wallpaper.mp3", index=1) == "01 - Artist - HD Wallpaper.mp3"


def test_trailing_dash_tag_and_bracket_ambiguous_removed():
    assert fb.clean_and_number_filename("Title - Official Video.mp3", index=1) == "01 - Title.mp3"
    assert fb.clean_and_number_filename("Title (HD).mp3", index=1) == "01 - Title.mp3"
    assert fb.clean_and_number_filename("Title - Official Video (HD).mp3", index=1) == "01 - Title.mp3"


def test_title_starting_with_number_is_kept():
    assert fb.clean_and_number_filename("1999 - Prince.mp3", index=1) == "01 - 1999 - Prince.mp3"
    assert fb.clean_and_number_filename("1-800-273-8255 - Logic.mp3", index=1) == "01 - 1-800-273-8255 - Logic.mp3"
    assert fb.clean_and_number_filename("05 - Song.mp3", index=1) == "01 - Song.mp3"


def test_apply_rejected_when_plan_drifted(tmp_path):
    names = ["a.mp3", "b.mp3"]
    with _setup(tmp_path, names):
        ok, _m, plan = fb.batch_rename_entries(tmp_path, names, preview_only=True)
        assert ok
        expected = {i["rel_path"]: i["new_rel_path"] for i in plan}
        (tmp_path / "01 - a.mp3").write_bytes(b"x")  # folder changed after preview
        ok, msg, _ = fb.batch_rename_entries(tmp_path, names, expected_plan=expected)
    assert not ok and "changed since the preview" in msg
    assert (tmp_path / "a.mp3").exists() and (tmp_path / "b.mp3").exists()


def test_apply_with_matching_plan(tmp_path):
    names = ["a.mp3", "b.mp3"]
    with _setup(tmp_path, names):
        _ok, _m, plan = fb.batch_rename_entries(tmp_path, names, preview_only=True)
        expected = {i["rel_path"]: i["new_rel_path"] for i in plan}
        ok, _msg, _ = fb.batch_rename_entries(tmp_path, names, expected_plan=expected)
    assert ok
    assert sorted(p.name for p in tmp_path.iterdir()) == ["01 - a.mp3", "02 - b.mp3"]


def _history_patch(tmp_path):
    return contextlib.nullcontext()


def test_undo_restores_names(tmp_path):
    names = ["a.mp3", "b.mp3"]
    with _setup(tmp_path, names), _history_patch(tmp_path):
        ok, _m, _p = fb.batch_rename_entries(tmp_path, names)
        assert ok and fb.peek_rename_history()["count"] == 2
        ok, _msg, pairs = fb.undo_last_batch_rename()
        assert ok and len(pairs) == 2
        assert fb.peek_rename_history() is None
    assert sorted(p.name for p in tmp_path.iterdir() if p.suffix == ".mp3") == names


def test_undo_refuses_when_original_name_taken(tmp_path):
    names = ["a.mp3"]
    with _setup(tmp_path, names), _history_patch(tmp_path):
        fb.batch_rename_entries(tmp_path, names)
        (tmp_path / "a.mp3").write_bytes(b"new")  # someone created a.mp3 again
        ok, msg, _ = fb.undo_last_batch_rename()
        assert not ok and "already exists" in msg
        assert fb.peek_rename_history() is not None
    assert (tmp_path / "01 - a.mp3").exists()


def test_undo_empty_history(tmp_path):
    with _setup(tmp_path, []), _history_patch(tmp_path):
        ok, _msg, _ = fb.undo_last_batch_rename()
    assert not ok


def test_ui_numbering_aliases():
    assert fb._normalize_numbering_mode("2digit_dash") == ("dash", 2)
    assert fb._normalize_numbering_mode("3digit_dash") == ("dash", 3)
    assert fb._normalize_numbering_mode("2digit_dot") == ("dot", 2)
    assert fb._normalize_numbering_mode("none") == ("keep", 2)
    assert fb._normalize_numbering_mode("garbage") == ("dash", 2)


def test_numbering_none_keeps_names_and_3digit_pads(tmp_path):
    with _setup(tmp_path, ["07 - Keep.mp3"]):
        ok, _m, plan = fb.batch_rename_entries(tmp_path, ["07 - Keep.mp3"], {"numbering_mode": "none"}, preview_only=True)
        assert ok and not plan[0]["changed"]
        ok, _m, plan = fb.batch_rename_entries(tmp_path, ["07 - Keep.mp3"], {"numbering_mode": "3digit_dash"}, preview_only=True)
    assert plan[0]["new_name"] == "001 - Keep.mp3"


def test_sort_by_name_is_natural(tmp_path):
    names = ["Track 10.mp3", "Track 2.mp3", "Track 1.mp3"]
    with _setup(tmp_path, names):
        _ok, _m, plan = fb.batch_rename_entries(tmp_path, names, {"sort_by": "name"}, preview_only=True)
    assert [i["new_name"] for i in plan] == ["01 - Track 1.mp3", "02 - Track 2.mp3", "03 - Track 10.mp3"]


def test_sort_by_selection_keeps_order(tmp_path):
    names = ["b.mp3", "a.mp3"]
    with _setup(tmp_path, names):
        _ok, _m, plan = fb.batch_rename_entries(tmp_path, names, preview_only=True)
    assert [i["new_name"] for i in plan] == ["01 - b.mp3", "02 - a.mp3"]


def test_single_rename_case_only(tmp_path):
    with _setup(tmp_path, ["song.mp3"]):
        ok, _msg, _o, _n = fb.rename_fs_entry(tmp_path, "song.mp3", "Song")
    assert ok
    assert [p.name for p in tmp_path.iterdir()] == ["Song.mp3"]


def _fake_tags(mapping):
    return lambda p: mapping.get(p.name, {})


def test_organize_preview_apply_and_undo(tmp_path):
    names = ["x.mp3", "y.mp3", "z.mp3"]
    tags = _fake_tags({
        "x.mp3": {"artist": "Band", "album": "Alpha"},
        "y.mp3": {"artist": "Band", "album": "Beta/Live"},
        "z.mp3": {},
    })
    with _setup(tmp_path, names):
        ok, _m, plan = fb.organize_into_folders(tmp_path, names, preview_only=True, tag_reader=tags)
        assert ok and all(i["changed"] for i in plan)
        assert (tmp_path / "x.mp3").exists()  # preview moves nothing
        expected = {i["rel_path"]: i["new_rel_path"] for i in plan}
        ok, _m, _p = fb.organize_into_folders(tmp_path, names, expected_plan=expected, tag_reader=tags)
        assert ok
        assert (tmp_path / "Band" / "Alpha" / "x.mp3").exists()
        assert (tmp_path / "Band" / "Beta_Live" / "y.mp3").exists()
        assert (tmp_path / "Unknown Artist" / "Singles" / "z.mp3").exists()
        ok, _msg, _pairs = fb.undo_last_batch_rename()
        assert ok
    assert sorted(p.name for p in tmp_path.iterdir()) == names


def test_organize_never_overwrites_and_artist_template(tmp_path):
    (tmp_path / "Band").mkdir()
    (tmp_path / "Band" / "x.mp3").write_bytes(b"existing")
    (tmp_path / "x.mp3").write_bytes(b"incoming")
    tags = _fake_tags({"x.mp3": {"artist": "Band"}})
    with _setup(tmp_path, []):
        ok, _m, plan = fb.organize_into_folders(
            tmp_path, ["x.mp3"], template="artist", tag_reader=tags)
    assert ok
    assert not plan[0]["changed"] and plan[0]["reason"]
    assert (tmp_path / "Band" / "x.mp3").read_bytes() == b"existing"
    assert (tmp_path / "x.mp3").read_bytes() == b"incoming"
