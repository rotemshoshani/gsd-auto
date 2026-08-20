from __future__ import annotations

import importlib.util
from importlib.machinery import SourceFileLoader
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "herdr-space" / "herdr-space"
SPEC = importlib.util.spec_from_loader("herdr_space", SourceFileLoader("herdr_space", str(SCRIPT)))
assert SPEC and SPEC.loader
herdr_space = importlib.util.module_from_spec(SPEC)
sys.modules["herdr_space"] = herdr_space
SPEC.loader.exec_module(herdr_space)


def write_preset(directory: Path, name: str, payload: object) -> Path:
    path = directory / f"{name}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


VALID = {
    "label": "server",
    "tabs": [
        {"label": "prod", "cwd": "~", "command": "prod-env"},
        {"label": "dev", "cwd": "~", "command": "dev-env"},
    ],
}


class LoadPresetTests(unittest.TestCase):
    def test_reads_label_and_tabs_in_file_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", VALID)
            preset = herdr_space.load_preset(path)
        self.assertEqual(preset.name, "server")
        self.assertEqual(preset.label, "server")
        self.assertEqual([tab.label for tab in preset.tabs], ["prod", "dev"])
        self.assertEqual([tab.command for tab in preset.tabs], ["prod-env", "dev-env"])

    def test_name_comes_from_filename_not_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = dict(VALID, label="Meniv Server")
            path = write_preset(Path(tmp), "server", payload)
            preset = herdr_space.load_preset(path)
        self.assertEqual(preset.name, "server")
        self.assertEqual(preset.label, "Meniv Server")

    def test_tab_cwd_expands_user_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", VALID)
            preset = herdr_space.load_preset(path)
        self.assertEqual(preset.tabs[0].cwd, str(Path.home()))

    def test_tab_without_cwd_inherits_preset_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = {"label": "s", "cwd": "/tmp", "tabs": [{"label": "a", "command": "ls"}]}
            path = write_preset(Path(tmp), "server", payload)
            preset = herdr_space.load_preset(path)
        self.assertEqual(preset.tabs[0].cwd, "/tmp")

    def test_tab_command_is_optional_and_defaults_to_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = {"label": "s", "cwd": "/tmp", "tabs": [{"label": "a"}]}
            path = write_preset(Path(tmp), "server", payload)
            preset = herdr_space.load_preset(path)
        self.assertEqual(preset.tabs[0].command, "")

    def test_malformed_json_raises_config_error_naming_the_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(herdr_space.ConfigError) as ctx:
                herdr_space.load_preset(path)
        self.assertIn("broken.json", str(ctx.exception))

    def test_missing_label_raises_config_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", {"tabs": VALID["tabs"]})
            with self.assertRaises(herdr_space.ConfigError) as ctx:
                herdr_space.load_preset(path)
        self.assertIn("label", str(ctx.exception))

    def test_empty_tabs_list_raises_config_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", {"label": "s", "tabs": []})
            with self.assertRaises(herdr_space.ConfigError) as ctx:
                herdr_space.load_preset(path)
        self.assertIn("tabs", str(ctx.exception))

    def test_duplicate_tab_labels_raise_config_error(self) -> None:
        payload = {
            "label": "s",
            "cwd": "/tmp",
            "tabs": [{"label": "a", "command": "ls"}, {"label": "a", "command": "pwd"}],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", payload)
            with self.assertRaises(herdr_space.ConfigError) as ctx:
                herdr_space.load_preset(path)
        self.assertIn("duplicate", str(ctx.exception).lower())

    def test_unsupported_version_raises_config_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = write_preset(Path(tmp), "server", dict(VALID, version=99))
            with self.assertRaises(herdr_space.ConfigError) as ctx:
                herdr_space.load_preset(path)
        self.assertIn("version", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()


class DiscoverPresetsTests(unittest.TestCase):
    def test_returns_presets_sorted_by_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_preset(Path(tmp), "server", VALID)
            write_preset(Path(tmp), "admin", VALID)
            presets = herdr_space.discover_presets(Path(tmp))
        self.assertEqual([preset.name for preset in presets], ["admin", "server"])

    def test_ignores_files_that_are_not_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_preset(Path(tmp), "server", VALID)
            (Path(tmp) / "README.md").write_text("# notes", encoding="utf-8")
            (Path(tmp) / "herdr-space").write_text("#!/usr/bin/env python3", encoding="utf-8")
            presets = herdr_space.discover_presets(Path(tmp))
        self.assertEqual([preset.name for preset in presets], ["server"])

    def test_returns_empty_list_when_no_presets_exist(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(herdr_space.discover_presets(Path(tmp)), [])

    def test_one_broken_preset_raises_config_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            write_preset(Path(tmp), "server", VALID)
            (Path(tmp) / "broken.json").write_text("{", encoding="utf-8")
            with self.assertRaises(herdr_space.ConfigError):
                herdr_space.discover_presets(Path(tmp))


class MissingDirectoriesTests(unittest.TestCase):
    def test_reports_tab_cwds_that_do_not_exist(self) -> None:
        payload = {
            "label": "s",
            "tabs": [
                {"label": "here", "cwd": "/tmp", "command": "ls"},
                {"label": "gone", "cwd": "/tmp/definitely-not-a-real-dir-xyz", "command": "ls"},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            preset = herdr_space.load_preset(write_preset(Path(tmp), "server", payload))
        self.assertEqual(
            herdr_space.missing_directories(preset),
            [("gone", "/tmp/definitely-not-a-real-dir-xyz")],
        )

    def test_reports_nothing_when_every_cwd_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            payload = {"label": "s", "cwd": tmp, "tabs": [{"label": "a", "command": "ls"}]}
            preset = herdr_space.load_preset(write_preset(Path(tmp), "server", payload))
            self.assertEqual(herdr_space.missing_directories(preset), [])


class FakeRunner:
    """Stands in for subprocess.run: records argv, replays queued results."""

    def __init__(self, results: list[object] | None = None) -> None:
        self.calls: list[list[str]] = []
        self.inputs: list[str | None] = []
        self.results = list(results or [])
        self.default = SimpleNamespace(returncode=0, stdout='{"result": {}}', stderr="")

    def __call__(self, argv, **kwargs):  # noqa: ANN001, ANN003
        self.calls.append(list(argv))
        self.inputs.append(kwargs.get("input"))
        if self.results:
            return self.results.pop(0)
        return self.default


def ok(result: object) -> SimpleNamespace:
    return SimpleNamespace(returncode=0, stdout=json.dumps({"result": result}), stderr="")


def workspace_list(*labels: str) -> SimpleNamespace:
    workspaces = [
        {"workspace_id": f"w{index}", "label": label} for index, label in enumerate(labels, start=1)
    ]
    return ok({"type": "workspace_list", "workspaces": workspaces})


class HerdrCLITests(unittest.TestCase):
    def test_invokes_the_herdr_binary_and_returns_the_result_object(self) -> None:
        runner = FakeRunner([ok({"type": "workspace_list", "workspaces": []})])
        cli = herdr_space.HerdrCLI(runner=runner)
        result = cli("workspace", "list")
        self.assertEqual(runner.calls, [["herdr", "workspace", "list"]])
        self.assertEqual(result, {"type": "workspace_list", "workspaces": []})

    def test_non_zero_exit_raises_herdr_error_carrying_stderr(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=1, stdout="", stderr="no such workspace")])
        cli = herdr_space.HerdrCLI(runner=runner)
        with self.assertRaises(herdr_space.HerdrError) as ctx:
            cli("workspace", "get", "w99")
        self.assertIn("no such workspace", str(ctx.exception))

    def test_a_command_that_prints_nothing_yields_an_empty_result(self) -> None:
        # `herdr pane run` succeeds with no stdout at all.
        runner = FakeRunner([SimpleNamespace(returncode=0, stdout="", stderr="")])
        cli = herdr_space.HerdrCLI(runner=runner)
        self.assertEqual(cli("pane", "run", "w1:p1", "ls"), {})

    def test_unparseable_output_raises_herdr_error(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=0, stdout="not json", stderr="")])
        cli = herdr_space.HerdrCLI(runner=runner)
        with self.assertRaises(herdr_space.HerdrError):
            cli("workspace", "list")


class WorkspaceLookupTests(unittest.TestCase):
    def test_finds_the_workspace_id_for_an_existing_label(self) -> None:
        cli = herdr_space.HerdrCLI(runner=FakeRunner([workspace_list("major", "server")]))
        self.assertEqual(herdr_space.workspace_id_for_label(cli, "server"), "w2")

    def test_returns_none_when_no_workspace_carries_the_label(self) -> None:
        cli = herdr_space.HerdrCLI(runner=FakeRunner([workspace_list("major", "brain")]))
        self.assertIsNone(herdr_space.workspace_id_for_label(cli, "server"))

    def test_label_must_match_exactly_not_as_a_prefix(self) -> None:
        cli = herdr_space.HerdrCLI(runner=FakeRunner([workspace_list("server-old")]))
        self.assertIsNone(herdr_space.workspace_id_for_label(cli, "server"))


def make_preset(*tabs: tuple[str, str, str], label: str = "server") -> object:
    payload = {
        "label": label,
        "tabs": [{"label": t[0], "cwd": t[1], "command": t[2]} for t in tabs],
    }
    with tempfile.TemporaryDirectory() as tmp:
        return herdr_space.load_preset(write_preset(Path(tmp), label, payload))


TWO_TABS = (("prod", "/tmp", "prod-env"), ("dev", "/tmp", "dev-env"))

CREATED = ok(
    {
        "workspace": {"workspace_id": "w9", "label": "server"},
        "tab": {"tab_id": "w9:t1"},
        "root_pane": {"pane_id": "w9:p1"},
    }
)
TAB_TWO = ok({"tab": {"tab_id": "w9:t2"}, "root_pane": {"pane_id": "w9:p2"}})


class LaunchExistingWorkspaceTests(unittest.TestCase):
    def test_focuses_the_open_workspace_instead_of_creating_a_second_one(self) -> None:
        runner = FakeRunner([workspace_list("server"), ok({})])
        cli = herdr_space.HerdrCLI(runner=runner)
        result = herdr_space.launch_preset(cli, make_preset(*TWO_TABS), settle=lambda: None)

        self.assertEqual(result.action, "focused")
        self.assertEqual(result.workspace_id, "w1")
        self.assertEqual(
            runner.calls,
            [["herdr", "workspace", "list"], ["herdr", "workspace", "focus", "w1"]],
        )


class LaunchNewWorkspaceTests(unittest.TestCase):
    def build(self, *tabs: tuple[str, str, str]) -> tuple[FakeRunner, object]:
        queued = [workspace_list(), CREATED, ok({}), ok({}), TAB_TWO, ok({}), ok({})]
        runner = FakeRunner(queued)
        cli = herdr_space.HerdrCLI(runner=runner)
        result = herdr_space.launch_preset(cli, make_preset(*tabs), settle=lambda: None)
        return runner, result

    def test_creates_the_workspace_with_the_preset_label_and_first_tab_cwd(self) -> None:
        runner, result = self.build(*TWO_TABS)
        self.assertEqual(result.action, "created")
        self.assertEqual(result.workspace_id, "w9")
        self.assertIn(
            ["herdr", "workspace", "create", "--cwd", "/tmp", "--label", "server", "--no-focus"],
            runner.calls,
        )

    def test_renames_the_free_first_tab_rather_than_creating_a_fourth(self) -> None:
        runner, _ = self.build(*TWO_TABS)
        self.assertIn(["herdr", "tab", "rename", "w9:t1", "prod"], runner.calls)
        self.assertEqual(sum(1 for call in runner.calls if call[1:3] == ["tab", "create"]), 1)

    def test_creates_each_remaining_tab_with_its_own_label_and_cwd(self) -> None:
        runner, _ = self.build(*TWO_TABS)
        self.assertIn(
            ["herdr", "tab", "create", "--workspace", "w9", "--cwd", "/tmp",
             "--label", "dev", "--no-focus"],
            runner.calls,
        )

    def test_runs_each_tab_command_in_that_tabs_root_pane(self) -> None:
        runner, _ = self.build(*TWO_TABS)
        runs = [call[1:] for call in runner.calls if call[1] == "pane"]
        self.assertEqual(runs, [["pane", "run", "w9:p1", "prod-env"], ["pane", "run", "w9:p2", "dev-env"]])

    def test_focuses_the_new_workspace_last(self) -> None:
        runner, _ = self.build(*TWO_TABS)
        self.assertEqual(runner.calls[-1], ["herdr", "workspace", "focus", "w9"])

    def test_a_tab_without_a_command_gets_a_plain_shell(self) -> None:
        runner, _ = self.build(("prod", "/tmp", "prod-env"), ("shell", "/tmp", ""))
        runs = [call for call in runner.calls if call[1] == "pane"]
        self.assertEqual(runs, [["herdr", "pane", "run", "w9:p1", "prod-env"]])

    def test_waits_for_each_shell_prompt_before_typing_its_command(self) -> None:
        settles: list[int] = []
        runner = FakeRunner([workspace_list(), CREATED, ok({}), ok({}), TAB_TWO, ok({}), ok({})])
        cli = herdr_space.HerdrCLI(runner=runner)
        herdr_space.launch_preset(
            cli, make_preset(*TWO_TABS), settle=lambda: settles.append(len(runner.calls))
        )
        self.assertEqual(len(settles), 2)


class DescribePresetTests(unittest.TestCase):
    def test_shows_the_workspace_label_and_every_tab(self) -> None:
        text = herdr_space.describe_preset(make_preset(*TWO_TABS))
        self.assertIn("server", text)
        for expected in ("prod", "prod-env", "dev", "dev-env", "/tmp"):
            self.assertIn(expected, text)

    def test_marks_a_commandless_tab_as_a_plain_shell(self) -> None:
        text = herdr_space.describe_preset(make_preset(("shell", "/tmp", "")))
        self.assertIn("shell", text.lower())


class SelectPresetTests(unittest.TestCase):
    def presets(self) -> list[object]:
        with tempfile.TemporaryDirectory() as tmp:
            write_preset(Path(tmp), "server", VALID)
            write_preset(Path(tmp), "admin", VALID)
            return herdr_space.discover_presets(Path(tmp))

    def test_returns_the_preset_whose_name_fzf_printed(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=0, stdout="server\n", stderr="")])
        chosen = herdr_space.select_preset(self.presets(), runner=runner)
        self.assertEqual(chosen.name, "server")

    def test_offers_every_preset_name_on_stdin(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=0, stdout="server\n", stderr="")])
        herdr_space.select_preset(self.presets(), runner=runner)
        self.assertEqual(runner.inputs[0], "admin\nserver")

    def test_returns_none_when_the_picker_is_cancelled(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=130, stdout="", stderr="")])
        self.assertIsNone(herdr_space.select_preset(self.presets(), runner=runner))

    def test_returns_none_when_the_selection_matches_no_preset(self) -> None:
        runner = FakeRunner([SimpleNamespace(returncode=0, stdout="ghost\n", stderr="")])
        self.assertIsNone(herdr_space.select_preset(self.presets(), runner=runner))


class MainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        write_preset(self.dir, "server", {"label": "server", "cwd": "/tmp",
                                          "tabs": [{"label": "prod", "command": "prod-env"}]})
        write_preset(self.dir, "admin", {"label": "admin", "cwd": "/tmp",
                                         "tabs": [{"label": "a", "command": "ls"}]})

    def run_main(self, argv, results=None, picker=None):
        runner = FakeRunner(results or [workspace_list(), CREATED, ok({}), ok({}), ok({})])
        cli = herdr_space.HerdrCLI(runner=runner)
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = herdr_space.main(
                argv, preset_dir=self.dir, cli=cli, picker=picker, settle=lambda: None
            )
        return code, stdout.getvalue(), stderr.getvalue(), runner

    def test_list_prints_every_preset_name_without_touching_herdr(self) -> None:
        code, out, _, runner = self.run_main(["--list"])
        self.assertEqual(code, 0)
        self.assertEqual(out.split(), ["admin", "server"])
        self.assertEqual(runner.calls, [])

    def test_describe_prints_the_preview_for_one_preset(self) -> None:
        code, out, _, _ = self.run_main(["--describe", "server"])
        self.assertEqual(code, 0)
        self.assertIn("prod-env", out)

    def test_naming_a_preset_launches_it_without_opening_the_picker(self) -> None:
        def explode() -> None:
            raise AssertionError("picker must not run when a preset is named")

        code, out, _, runner = self.run_main(["server"], picker=lambda presets: explode())
        self.assertEqual(code, 0)
        self.assertIn(["herdr", "workspace", "create", "--cwd", "/tmp",
                       "--label", "server", "--no-focus"], runner.calls)

    def test_no_argument_launches_whatever_the_picker_returns(self) -> None:
        seen: list[list[str]] = []

        def picker(presets):
            seen.append([preset.name for preset in presets])
            return presets[1]

        code, _, _, runner = self.run_main([], picker=picker)
        self.assertEqual(code, 0)
        self.assertEqual(seen, [["admin", "server"]])
        self.assertIn(["herdr", "workspace", "create", "--cwd", "/tmp",
                       "--label", "server", "--no-focus"], runner.calls)

    def test_cancelling_the_picker_changes_nothing(self) -> None:
        code, _, _, runner = self.run_main([], picker=lambda presets: None)
        self.assertEqual(code, 130)
        self.assertEqual(runner.calls, [])

    def test_unknown_preset_name_is_an_error_listing_what_exists(self) -> None:
        code, _, err, runner = self.run_main(["ghost"])
        self.assertEqual(code, 2)
        self.assertIn("ghost", err)
        self.assertIn("server", err)
        self.assertEqual(runner.calls, [])

    def test_reports_an_already_open_workspace_instead_of_duplicating_it(self) -> None:
        code, out, _, runner = self.run_main(["server"], results=[workspace_list("server"), ok({})])
        self.assertEqual(code, 0)
        self.assertIn("already open", out)
        self.assertNotIn("create", [call[2] for call in runner.calls if call[1] == "workspace"])

    def test_a_missing_tab_directory_stops_the_launch_before_anything_is_created(self) -> None:
        write_preset(self.dir, "broken", {"label": "broken", "cwd": "/tmp/not-a-real-dir-xyz",
                                          "tabs": [{"label": "a", "command": "ls"}]})
        code, _, err, runner = self.run_main(["broken"])
        self.assertEqual(code, 1)
        self.assertIn("/tmp/not-a-real-dir-xyz", err)
        self.assertEqual(runner.calls, [])

    def test_an_empty_preset_directory_explains_itself(self) -> None:
        with tempfile.TemporaryDirectory() as empty:
            stdout, stderr = io.StringIO(), io.StringIO()
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = herdr_space.main([], preset_dir=Path(empty), cli=None, picker=None)
        self.assertEqual(code, 1)
        self.assertIn("no presets", stderr.getvalue().lower())

    def test_a_broken_preset_file_is_reported_by_name(self) -> None:
        (self.dir / "bad.json").write_text("{", encoding="utf-8")
        code, _, err, _ = self.run_main(["server"])
        self.assertEqual(code, 1)
        self.assertIn("bad.json", err)


class RequireBinariesTests(unittest.TestCase):
    def test_names_every_missing_binary(self) -> None:
        missing = herdr_space.require_binaries(["herdr", "fzf"], which=lambda name: None)
        self.assertEqual(missing, ["herdr", "fzf"])

    def test_returns_nothing_when_all_are_installed(self) -> None:
        missing = herdr_space.require_binaries(["herdr"], which=lambda name: "/usr/bin/" + name)
        self.assertEqual(missing, [])
