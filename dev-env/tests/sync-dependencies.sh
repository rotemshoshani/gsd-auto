#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

remote="$tmp_dir/remote.git"
seed="$tmp_dir/seed"
work="$tmp_dir/work"
state_dir="$tmp_dir/state"
stub_bin="$tmp_dir/bin"
npm_log="$tmp_dir/npm.log"
tmux_log="$tmp_dir/tmux.log"

mkdir -p "$stub_bin"

git -c init.defaultBranch=dev init --bare "$remote" >/dev/null
git -c init.defaultBranch=dev init "$seed" >/dev/null
git -C "$seed" config user.email "dev-env-test@example.com"
git -C "$seed" config user.name "dev-env test"

printf '%s\n' \
  '{"name":"sync-test","version":"1.0.0"}' >"$seed/package.json"
printf '%s\n' \
  '{"name":"sync-test","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"sync-test","version":"1.0.0"}}}' \
  >"$seed/package-lock.json"
printf 'node_modules/\n' >"$seed/.gitignore"
git -C "$seed" add package.json package-lock.json .gitignore
git -C "$seed" commit -m "initial" >/dev/null
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -u origin dev >/dev/null

git clone "$remote" "$work" >/dev/null

printf '%s\n' \
  '{"name":"sync-test","version":"1.0.1"}' >"$seed/package.json"
printf '%s\n' \
  '{"name":"sync-test","version":"1.0.1","lockfileVersion":3,"requires":true,"packages":{"":{"name":"sync-test","version":"1.0.1"}}}' \
  >"$seed/package-lock.json"
git -C "$seed" add package.json package-lock.json
git -C "$seed" commit -m "change dependencies" >/dev/null
git -C "$seed" push origin dev >/dev/null

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' 'printf "%s\n" "$*" >>"$DEV_ENV_NPM_LOG"'
  printf '%s\n' 'if [[ "${1:-}" == "ci" ]]; then mkdir -p node_modules; fi'
} >"$stub_bin/npm"
chmod +x "$stub_bin/npm"

{
  printf '%s\n' '#!/usr/bin/env bash'
  printf '%s\n' 'set -euo pipefail'
  printf '%s\n' 'case "${1:-}" in'
  printf '%s\n' '  show-environment)'
  printf '%s\n' '    case "${4:-}" in'
  printf '%s\n' '      DEV_TOP_ID) printf "DEV_TOP_ID=%%1\n" ;;'
  printf '%s\n' '      DEV_BOT_ID) printf "DEV_BOT_ID=%%2\n" ;;'
  printf '%s\n' '      DEV_PAUSED_RUN) printf "DEV_PAUSED_RUN=paused-run\n" ;;'
  printf '%s\n' '      DEV_TOP_RUN) printf "DEV_TOP_RUN=top-run\n" ;;'
  printf '%s\n' '      DEV_BOT_RUN) printf "DEV_BOT_RUN=bottom-run\n" ;;'
  printf '%s\n' '    esac'
  printf '%s\n' '    ;;'
  printf '%s\n' '  respawn-pane) printf "%s\n" "$*" >>"$DEV_ENV_TMUX_LOG" ;;'
  printf '%s\n' 'esac'
} >"$stub_bin/tmux"
chmod +x "$stub_bin/tmux"

DEV_ENV_NPM_LOG="$npm_log" \
DEV_ENV_TMUX_LOG="$tmux_log" \
PATH="$stub_bin:$PATH" \
  "$repo_root/dev-env" __sync_once "$work" origin dev test-session "$state_dir" >/dev/null

if ! grep -q '"version":"1.0.1"' "$work/package.json"; then
  echo "expected sync to fast-forward the project" >&2
  exit 1
fi

if [[ "$(grep -c '^ci$' "$npm_log")" != "1" ]]; then
  echo "expected exactly one clean dependency install" >&2
  cat "$npm_log" >&2
  exit 1
fi

if [[ "$(grep -c '^respawn-pane ' "$tmux_log")" != "4" ]]; then
  echo "expected both workers to pause and restart around dependency installation" >&2
  cat "$tmux_log" >&2
  exit 1
fi

if [[ ! -s "$state_dir/dependencies.fingerprint" ]]; then
  echo "expected dependency fingerprint outside the project" >&2
  exit 1
fi

DEV_ENV_NPM_LOG="$npm_log" \
DEV_ENV_TMUX_LOG="$tmux_log" \
PATH="$stub_bin:$PATH" \
  "$repo_root/dev-env" __sync_once "$work" origin dev test-session "$state_dir" >/dev/null

if [[ "$(grep -c '^ci$' "$npm_log")" != "1" ]]; then
  echo "expected unchanged dependencies not to reinstall" >&2
  cat "$npm_log" >&2
  exit 1
fi
