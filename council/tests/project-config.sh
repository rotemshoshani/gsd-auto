#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
utilities_root="$(cd "$repo_root/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

stub_bin="$tmp_dir/bin"
project_dir="$tmp_dir/project"
log_file="$tmp_dir/tmux.log"
mkdir -p "$stub_bin" "$project_dir"

cat >"$stub_bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$COUNCIL_TMUX_LOG"
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%%0\n' ;;
  split-window) printf '%%1\n' ;;
  display-message) printf '20\n' ;;
esac
EOF
chmod +x "$stub_bin/tmux"

cat >"$project_dir/.rsh-utils.json" <<'EOF'
{"version":1,"council":{"claude_command":"claude-from-config","codex_command":"codex-from-config","capture_lines":321,"paste_settle_seconds":2}}
EOF

(
  cd "$project_dir"
  COUNCIL_TMUX_LOG="$log_file" TMUX=stub PATH="$stub_bin:$PATH" "$repo_root/council" >/dev/null
)

grep -q 'claude-from-config' "$log_file"
grep -q 'codex-from-config' "$log_file"

: >"$log_file"
(
  cd "$project_dir"
  COUNCIL_TMUX_LOG="$log_file" COUNCIL_CLAUDE='claude-from-environment' TMUX=stub PATH="$stub_bin:$PATH" "$repo_root/council" >/dev/null
)
grep -q 'claude-from-environment' "$log_file"

printf '{"version":1,"council":{"capture_lines":0}}\n' >"$project_dir/.rsh-utils.json"
if (cd "$project_dir" && PATH="$stub_bin:$PATH" "$repo_root/council" --help >/dev/null 2>&1); then
  echo 'expected invalid project config to fail' >&2
  exit 1
fi

python3 "$utilities_root/shared/project_config.py" "$utilities_root/.rsh-utils.example.json" council >/dev/null
