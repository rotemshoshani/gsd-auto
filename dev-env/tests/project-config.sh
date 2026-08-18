#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

stub_bin="$tmp_dir/bin"
project_dir="$tmp_dir/project"
log_file="$tmp_dir/tmux.log"
mkdir -p "$stub_bin" "$project_dir"

cat >"$stub_bin/tmux" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DEV_ENV_TMUX_LOG"
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%%0\n' ;;
  split-window) printf '%%1\n' ;;
  display-message) printf '20\n' ;;
esac
EOF
chmod +x "$stub_bin/tmux"

cat >"$project_dir/.rsh-utils.json" <<'EOF'
{"version":1,"dev_env":{"top_command":"from-config-top","bottom_command":"from-config-bottom","mode":"sync","interval_seconds":45,"restart_hours":null}}
EOF

(
  cd "$project_dir"
  DEV_ENV_TMUX_LOG="$log_file" PATH="$stub_bin:$PATH" "$repo_root/dev-env" --no-restart >/dev/null
)

grep -q 'from-config-top' "$log_file"
grep -q 'from-config-bottom' "$log_file"
grep -q '__sync_watcher.*45' "$log_file"
grep -q '__controller.* 0 off' "$log_file"

: >"$log_file"
(
  cd "$project_dir"
  DEV_ENV_TMUX_LOG="$log_file" DEV_ENV_TOP='from-environment' PATH="$stub_bin:$PATH" "$repo_root/dev-env" --override 'from-cli-top' 'from-cli-bottom' --no-sync >/dev/null
)

grep -q 'from-cli-top' "$log_file"
grep -q 'from-cli-bottom' "$log_file"
if grep -q '__sync_watcher' "$log_file"; then
  echo 'expected --no-sync to override configured sync mode' >&2
  exit 1
fi

printf '{"version":1,"dev_env":{"mode":"bad"}}\n' >"$project_dir/.rsh-utils.json"
if (cd "$project_dir" && PATH="$stub_bin:$PATH" "$repo_root/dev-env" --help >/dev/null 2>&1); then
  echo 'expected invalid project config to fail' >&2
  exit 1
fi
