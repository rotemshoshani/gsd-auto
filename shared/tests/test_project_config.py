from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
READER = ROOT / "shared" / "project_config.py"
EXAMPLE = ROOT / ".rsh-utils.example.json"


class ProjectConfigTests(unittest.TestCase):
    def read(self, data: object, tool: str = "dev_env") -> subprocess.CompletedProcess[bytes]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".rsh-utils.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return subprocess.run(["python3", str(READER), str(path), tool], capture_output=True, check=False)

    def test_example_is_valid_for_both_tools(self) -> None:
        for tool in ("dev_env", "council"):
            result = subprocess.run(["python3", str(READER), str(EXAMPLE), tool], capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_partial_config_emits_only_selected_values(self) -> None:
        result = self.read({"version": 1, "dev_env": {"mode": "sync", "restart_hours": None}})
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout.split(b"\0")[:-1], [b"mode", b"sync", b"restart_hours", b"off"])

    def test_rejects_invalid_config(self) -> None:
        result = self.read({"version": 1, "dev_env": {"interval_seconds": 4}})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"interval_seconds", result.stderr)

    def test_rejects_unknown_field_and_version(self) -> None:
        unknown = self.read({"version": 1, "council": {"unknown": True}}, "council")
        version = self.read({"version": 2})
        self.assertNotEqual(unknown.returncode, 0)
        self.assertNotEqual(version.returncode, 0)


if __name__ == "__main__":
    unittest.main()
