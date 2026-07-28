# dev-env

A tiny tmux launcher for projects with two long-running dev processes
(by default `npx convex dev` and `npm run dev`).

Spawns a tmux session in the current directory laid out like this:

```
┌─────────────────────────────┐
│  folder-name                │  ← tmux status bar
├─────────────────────────────┤
│  dev-env  [T] top [B] bot…  │  ← 1-row controller
├─────────────────────────────┤
│  top command output         │
├─────────────────────────────┤
│  bottom command output      │
└─────────────────────────────┘
```

The controller is a single-keypress menu for restarting either pane or
tearing the whole session down. Worker panes stay visible after their
command exits (success or crash), so you can read the final output and
restart from the controller. By default, the controller also restarts both
worker panes every three hours.

## Prerequisites

- `bash` 4+
- `tmux` 3.0+
- A terminal that supports `tput` (almost all do — this is used to detect
  the real terminal size at launch)

Linux and macOS are both fine.

## Setup

```bash
# Clone the parent repo somewhere, e.g. ~/projects/utilities
git clone <repo-url> ~/projects/utilities

# Symlink dev-env into a directory on your PATH
ln -s ~/projects/utilities/dev-env/dev-env ~/.local/bin/dev-env
# (make sure ~/.local/bin is on $PATH)
```

Verify:

```bash
dev-env --help
```

## Usage

From any project directory:

```bash
dev-env
```

This runs the defaults: `npx convex dev` in the top pane and
`npm run dev` in the bottom pane.

Override the commands:

```bash
dev-env --override "pnpm api:dev" "pnpm web:dev"
```

Keep the local `dev` branch current with `origin/dev` while the session runs:

```bash
dev-env --pull
```

With `--pull`, `dev-env` adds a one-row pull pane to the main `dev` window.
Every 30 seconds it fetches `origin/dev`, prints `git status --short --branch`,
and fast-forwards the local `dev` branch when `origin/dev` changes. It does
not restart the dev panes.

For a laptop or test machine that should continuously follow another
development machine, use sync mode:

```bash
dev-env --sync
```

`--sync` includes the pull watcher and adds dependency-aware recovery:

- It fast-forwards only. Local commits, a different branch, or diverged history
  are never reset, stashed, or reconciled automatically.
- It fingerprints `package.json` and the detected lockfile. When that
  fingerprint changes, it pauses both workers, performs a frozen clean install,
  and restarts them.
- It supports npm, pnpm, Yarn, and Bun lockfiles. The corresponding commands are
  `npm ci`, `pnpm install --frozen-lockfile`, Yarn's immutable/frozen install,
  and `bun install --frozen-lockfile`.
- Runtime configuration changes such as `next.config.*`, `tsconfig.json`, and
  `convex.json` restart both workers. Normal source changes are left to the
  frameworks' hot reloaders.
- A worker that exits is restarted with exponential backoff, capped at two
  minutes.

Dependency fingerprints live under `~/.cache/dev-env/` (or
`$XDG_CACHE_HOME/dev-env/`), keyed by the canonical project path. No state is
written into the project.

Change the polling interval for either watcher:

```bash
dev-env --sync --interval 60
dev-env --pull --interval 15
```

The default is 30 seconds and the minimum is 5 seconds. Polling happens only
while the tmux environment is running.

To repair the local dependency installation before launching:

```bash
dev-env --repair --sync
```

`--repair` verifies the package-manager cache when a safe generic check exists,
then performs the same frozen clean install. It does not edit manifests,
lockfiles, dotenv files, or source files. It also does not run `npm audit fix`.

Change the automatic restart interval (in hours), or disable it:

```bash
dev-env --restart 6
dev-env --no-restart
```

`--restart` accepts positive whole or decimal hour values. A manual `A`
restart starts a fresh interval; restarting just one pane leaves the shared
timer unchanged.

Or via environment variables:

```bash
DEV_ENV_TOP="pnpm api:dev" DEV_ENV_BOTTOM="pnpm web:dev" dev-env
```

Re-running `dev-env` in a directory that already has a session kills that
session and creates a fresh one. Before launch it also stops known dev-server
processes (`npm run dev`, `next dev` / `next-server`, `npx convex dev`) whose
working directory is the current project, including processes started from a
regular terminal.

### Controller keys

Focus the controller pane (it's focused by default on attach) and press:

| Key | Action                          |
|-----|---------------------------------|
| `T` | Restart the top pane            |
| `B` | Restart the bottom pane         |
| `A` | Restart both                    |
| `Q` | Kill everything (tmux + procs)  |

No `Enter` needed — single keypress.

### Session naming

The tmux session is named `dev-<basename of cwd>`, sanitized to
alphanumerics, hyphens and underscores. You can manage it like any other
tmux session (`tmux ls`, `tmux attach -t dev-…`, etc.).
