"""Minimal test runner for environments without pytest: python3 tests/run_tests.py"""
import inspect
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_organizer as t  # noqa: E402

failed = 0
for name, fn in inspect.getmembers(t, inspect.isfunction):
    if not name.startswith("test_"):
        continue
    try:
        if "tmp_path" in inspect.signature(fn).parameters:
            with tempfile.TemporaryDirectory() as d:
                fn(Path(d))
        else:
            fn()
        print("PASS", name)
    except Exception as exc:  # noqa: BLE001
        failed += 1
        print("FAIL", name, repr(exc))
sys.exit(1 if failed else 0)

