from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import json
import tempfile
import unittest
from subprocess import CompletedProcess
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "prod-env" / "prod-env"
SPEC = importlib.util.spec_from_loader("prod_env", SourceFileLoader("prod_env", str(SCRIPT)))
assert SPEC and SPEC.loader
prod_env = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prod_env)


class ProdEnvTests(unittest.TestCase):
    def test_errors_mode_keeps_only_error_lines_and_failures(self) -> None:
        event = {
            "kind": "Completion",
            "timestamp": 1_700_000_000,
            "udfType": "Mutation",
            "identifier": "leads:create",
            "logLines": [
                {"level": "INFO", "messages": ["starting"], "timestamp": 1_700_000_000_000},
                {"level": "ERROR", "messages": ["provider failed"], "timestamp": 1_700_000_001_000},
            ],
            "error": "Uncaught Error: failed",
        }
        rendered = prod_env.format_convex_event(event, "errors")
        self.assertEqual(len(rendered), 2)
        self.assertTrue(all(prod_env.RED in line for line in rendered))
        self.assertNotIn("starting", "\n".join(rendered))

    def test_all_mode_colors_each_severity(self) -> None:
        event = {
            "kind": "Completion",
            "timestamp": 1_700_000_000,
            "udfType": "Query",
            "identifier": "health:check",
            "executionTime": 0.012,
            "logLines": [
                {"level": "WARN", "messages": ["slow"]},
                {"level": "DEBUG", "messages": ["details"]},
            ],
        }
        rendered = prod_env.format_convex_event(event, "all")
        self.assertIn(prod_env.YELLOW, rendered[0])
        self.assertIn(prod_env.DIM, rendered[1])
        self.assertIn(prod_env.GREEN, rendered[2])

    def test_vercel_formatter_filters_target_and_reports_latest_error(self) -> None:
        parsed = {
            "contextName": "team",
            "deployments": [
                {"state": "ERROR", "target": "production", "createdAt": 1_700_000_000_000, "url": "bad.example", "meta": {}},
                {"state": "READY", "target": "preview", "createdAt": 1_699_000_000_000, "url": "preview.example", "meta": {}},
                {"state": "READY", "target": "production", "createdAt": 1_698_000_000_000, "url": "good.example", "meta": {}},
            ],
        }
        lines, error_url = prod_env.format_vercel_status(parsed, "production")
        output = "\n".join(lines)
        self.assertEqual(error_url, "bad.example")
        self.assertIn("bad.example", output)
        self.assertIn("good.example", output)
        self.assertNotIn("preview.example", output)
        self.assertIn(prod_env.RED, output)

    def test_loads_valid_project_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / ".rsh-utils.json").write_text(json.dumps({
                "version": 1,
                "prod_env": {"panes": [
                    {"type": "command", "title": "One", "command": "true"},
                    {"type": "command", "title": "Two", "command": "true"},
                    {"type": "command", "title": "Three", "command": "true"},
                ]},
            }), encoding="utf-8")
            config = prod_env.load_prod_env(project)
            self.assertEqual([pane["title"] for pane in config["panes"]], ["One", "Two", "Three"])

    def test_launch_chooses_layout_for_pane_count(self) -> None:
        for count, expected_layout in ((1, None), (2, "even-vertical"), (3, "tiled")):
            calls = []
            next_pane = 0

            def fake_tmux(socket, *args, capture=False):
                nonlocal next_pane
                calls.append(args)
                output = ""
                if args[0] in {"new-session", "split-window"}:
                    output = f"%{next_pane}\n"
                    next_pane += 1
                return CompletedProcess(["tmux"], 0, output, "")

            panes = [
                {"type": "command", "title": f"Pane {index}", "command": "true"}
                for index in range(1, count + 1)
            ]
            with self.subTest(count=count), patch.object(prod_env, "load_prod_env", return_value={"panes": panes}), patch.object(
                prod_env, "tmux", side_effect=fake_tmux
            ), patch.object(prod_env.shutil, "which", return_value="/bin/tool"), patch.object(
                prod_env.os, "execvpe", side_effect=RuntimeError("attached")
            ):
                with self.assertRaisesRegex(RuntimeError, "attached"):
                    prod_env.launch(Path("/tmp/example").resolve())

            layouts = [args[-1] for args in calls if args[0] == "select-layout"]
            if expected_layout is None:
                self.assertEqual(layouts, [])
            else:
                self.assertEqual(layouts[-1], expected_layout)


if __name__ == "__main__":
    unittest.main()
