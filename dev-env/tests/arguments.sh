#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

help_output=$("$repo_root/dev-env" --restart 1.5 --help)

grep -q -- '--restart HOURS' <<<"$help_output"
grep -q -- '--no-restart' <<<"$help_output"

"$repo_root/dev-env" --no-restart --help >/dev/null

for invalid_hours in nope 0 0.0001; do
  if "$repo_root/dev-env" --restart "$invalid_hours" --help >/dev/null 2>&1; then
    echo "expected --restart $invalid_hours to fail" >&2
    exit 1
  fi
done
