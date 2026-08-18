#!/usr/bin/env python3
"""Read and validate a project-local .rsh-utils.json configuration file."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


class ConfigError(ValueError):
    pass


def fail(message: str) -> None:
    raise ConfigError(message)


def object_value(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail(f"{name} must be an object")
    return value


def string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value:
        fail(f"{name} must be a non-empty string")
    return value


def integer(value: Any, name: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        fail(f"{name} must be an integer of at least {minimum}")
    return value


def positive_number(value: Any, name: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        fail(f"{name} must be a positive number")
    return value


def validate_section(raw: dict[str, Any], section: str, fields: set[str]) -> dict[str, Any]:
    value = raw.get(section, {})
    data = object_value(value, section)
    unknown = sorted(set(data) - fields)
    if unknown:
        fail(f"{section} has unsupported field(s): {', '.join(unknown)}")
    return data


def dev_env_values(raw: dict[str, Any]) -> dict[str, str]:
    data = validate_section(raw, "dev_env", {
        "top_command", "bottom_command", "mode", "repair", "remote", "branch",
        "interval_seconds", "restart_hours",
    })
    result: dict[str, str] = {}
    for field in ("top_command", "bottom_command", "remote", "branch"):
        if field in data:
            result[field] = string(data[field], f"dev_env.{field}")
    if "mode" in data:
        mode = string(data["mode"], "dev_env.mode")
        if mode not in {"normal", "pull", "sync"}:
            fail("dev_env.mode must be one of: normal, pull, sync")
        result["mode"] = mode
    if "repair" in data:
        if not isinstance(data["repair"], bool):
            fail("dev_env.repair must be a boolean")
        result["repair"] = "true" if data["repair"] else "false"
    if "interval_seconds" in data:
        result["interval_seconds"] = str(integer(data["interval_seconds"], "dev_env.interval_seconds", 5))
    if "restart_hours" in data:
        restart_hours = data["restart_hours"]
        result["restart_hours"] = "off" if restart_hours is None else str(positive_number(restart_hours, "dev_env.restart_hours"))
    return result


def council_values(raw: dict[str, Any]) -> dict[str, str]:
    data = validate_section(raw, "council", {
        "claude_command", "codex_command", "approval_key", "capture_lines",
        "claude_ready_pattern", "codex_ready_pattern", "ready_timeout_seconds",
        "claude_chrome_marker", "claude_chrome_lines", "codex_chrome_marker",
        "codex_chrome_lines", "paste_settle_seconds", "terminal",
    })
    result: dict[str, str] = {}
    for field in (
        "claude_command", "codex_command", "approval_key", "claude_ready_pattern",
        "codex_ready_pattern", "claude_chrome_marker", "claude_chrome_lines",
        "codex_chrome_marker", "codex_chrome_lines",
    ):
        if field in data:
            result[field] = string(data[field], f"council.{field}")
    if "capture_lines" in data:
        result["capture_lines"] = str(integer(data["capture_lines"], "council.capture_lines", 1))
    if "ready_timeout_seconds" in data:
        result["ready_timeout_seconds"] = str(integer(data["ready_timeout_seconds"], "council.ready_timeout_seconds", 1))
    if "paste_settle_seconds" in data:
        settle = data["paste_settle_seconds"]
        result["paste_settle_seconds"] = "" if settle is None else str(positive_number(settle, "council.paste_settle_seconds"))
    if "terminal" in data:
        terminal = data["terminal"]
        result["terminal"] = "" if terminal is None else string(terminal, "council.terminal")
    return result


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[2] not in {"dev_env", "council"}:
        print("usage: project_config.py PATH {dev_env|council}", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        with path.open(encoding="utf-8") as config_file:
            raw = json.load(config_file)
        raw = object_value(raw, "root")
        unknown = sorted(set(raw) - {"version", "dev_env", "council"})
        if unknown:
            fail(f"root has unsupported field(s): {', '.join(unknown)}")
        if raw.get("version") != 1:
            fail("version must be 1")
        values = dev_env_values(raw) if sys.argv[2] == "dev_env" else council_values(raw)
    except (OSError, json.JSONDecodeError, ConfigError) as error:
        print(f"rsh-utils config error in {path}: {error}", file=sys.stderr)
        return 1

    for key, value in values.items():
        sys.stdout.buffer.write(key.encode() + b"\0" + value.encode() + b"\0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
