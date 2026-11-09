"""Minimal test runner for environments without pytest: python3 tests/run_tests.py"""
import importlib
import inspect
import sys
import tempfile
from pathlib import Path

tests_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(tests_dir))

test_files = sorted(p.stem for p in tests_dir.glob("test_*.py"))
failed = 0
total = 0

for mod_name in test_files:
    mod = importlib.import_module(mod_name)
    for name, fn in inspect.getmembers(mod, inspect.isfunction):
        if not name.startswith("test_"):
            continue
        total += 1
        try:
            if "tmp_path" in inspect.signature(fn).parameters:
                with tempfile.TemporaryDirectory() as d:
                    fn(Path(d))
            else:
                fn()
            print("PASS", f"{mod_name}.{name}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print("FAIL", f"{mod_name}.{name}", repr(exc))

print(f"\nSummary: {total - failed}/{total} passed.")
sys.exit(1 if failed else 0)

