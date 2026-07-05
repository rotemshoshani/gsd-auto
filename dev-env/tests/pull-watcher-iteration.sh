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
out_file="$tmp_dir/out"

git -c init.defaultBranch=dev init --bare "$remote" >/dev/null

git -c init.defaultBranch=dev init "$seed" >/dev/null
git -C "$seed" config user.email "dev-env-test@example.com"
git -C "$seed" config user.name "dev-env test"
printf 'one\n' >"$seed/file.txt"
git -C "$seed" add file.txt
git -C "$seed" commit -m "initial" >/dev/null
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -u origin dev >/dev/null

git clone "$remote" "$work" >/dev/null

printf 'two\n' >"$seed/file.txt"
git -C "$seed" commit -am "update" >/dev/null
git -C "$seed" push origin dev >/dev/null

"$repo_root/dev-env" __pull_once "$work" origin dev >"$out_file" 2>&1

if [[ "$(cat "$work/file.txt")" != "two" ]]; then
  echo "expected __pull_once to fast-forward worktree from origin/dev" >&2
  cat "$out_file" >&2
  exit 1
fi

if ! grep -q 'dev-env: origin/dev changed; fast-forwarding dev' "$out_file"; then
  echo "expected __pull_once to report the fast-forward" >&2
  cat "$out_file" >&2
  exit 1
fi
