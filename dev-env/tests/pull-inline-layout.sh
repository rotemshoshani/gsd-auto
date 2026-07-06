#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

stub_bin="$tmp_dir/bin"
project_dir="$tmp_dir/project"
log_file="$tmp_dir/tmux.log"
pane_counter="$tmp_dir/pane-counter"

mkdir -p "$stub_bin" "$project_dir"
printf '0\n' >"$pane_counter"

tmux_stub="$stub_bin/tmux"
{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' 'printf "%s" "$1" >>"$DEV_ENV_TMUX_LOG"'
  printf '%s\n' 'shift || true'
  printf '%s\n' 'for arg in "$@"; do printf " %q" "$arg" >>"$DEV_ENV_TMUX_LOG"; done'
  printf '%s\n' 'printf "\n" >>"$DEV_ENV_TMUX_LOG"'
  printf '%s\n' 'case "${DEV_ENV_TMUX_COMMAND:-}" in *) ;; esac'
  printf '%s\n' 'case "$(<"$DEV_ENV_TMUX_COUNTER")" in *[!0-9]*|"") printf "0\n" >"$DEV_ENV_TMUX_COUNTER" ;; esac'
  printf '%s\n' 'cmd="$(awk "{print \$1}" "$DEV_ENV_TMUX_LOG" | tail -n1)"'
  printf '%s\n' 'case "$cmd" in'
  printf '%s\n' '  has-session) exit 1 ;;'
  printf '%s\n' '  new-session) printf "%%0\n"; exit 0 ;;'
  printf '%s\n' '  split-window)'
  printf '%s\n' '    count="$(<"$DEV_ENV_TMUX_COUNTER")"'
  printf '%s\n' '    count=$((count + 1))'
  printf '%s\n' '    printf "%s\n" "$count" >"$DEV_ENV_TMUX_COUNTER"'
  printf '%s\n' '    printf "%%%s\n" "$count"'
  printf '%s\n' '    exit 0'
  printf '%s\n' '    ;;'
  printf '%s\n' '  display-message) printf "20\n"; exit 0 ;;'
  printf '%s\n' '  attach-session|switch-client|set-option|set-environment|select-window|select-pane|kill-session) exit 0 ;;'
  printf '%s\n' '  *) exit 0 ;;'
  printf '%s\n' 'esac'
} >"$tmux_stub"
chmod +x "$tmux_stub"

(
  cd "$project_dir"
  DEV_ENV_TMUX_LOG="$log_file" \
    DEV_ENV_TMUX_COUNTER="$pane_counter" \
    PATH="$stub_bin:$PATH" \
    "$repo_root/dev-env" --pull >/dev/null 2>&1
)

if grep -q '^new-window ' "$log_file"; then
  echo "expected --pull to keep pull logs in the main window, not create a new window" >&2
  cat "$log_file" >&2
  exit 1
fi

split_count="$(grep -c '^split-window ' "$log_file")"
if [[ "$split_count" != "3" ]]; then
  echo "expected --pull layout to create top, pull, and bottom panes; saw $split_count split-window calls" >&2
  cat "$log_file" >&2
  exit 1
fi

if ! grep -q '^split-window .* -l 1 .*__pull_watcher' "$log_file"; then
  echo "expected pull watcher to run in a 1-row pane" >&2
  cat "$log_file" >&2
  exit 1
fi
