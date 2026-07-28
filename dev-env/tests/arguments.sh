#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

help_output=$("$repo_root/dev-env" --restart 1.5 --help)

grep -q -- '--restart HOURS' <<<"$help_output"
grep -q -- '--no-restart' <<<"$help_output"
grep -q -- '--sync' <<<"$help_output"
grep -q -- '--interval SECONDS' <<<"$help_output"
grep -q -- '--repair' <<<"$help_output"

"$repo_root/dev-env" --no-restart --help >/dev/null
"$repo_root/dev-env" --sync --interval 45 --help >/dev/null

for invalid_hours in nope 0 0.0001; do
  if "$repo_root/dev-env" --restart "$invalid_hours" --help >/dev/null 2>&1; then
    echo "expected --restart $invalid_hours to fail" >&2
    exit 1
  fi
done

for invalid_interval in nope 0 4 1.5; do
  if "$repo_root/dev-env" --sync --interval "$invalid_interval" --help >/dev/null 2>&1; then
    echo "expected --interval $invalid_interval to fail" >&2
    exit 1
  fi
done
