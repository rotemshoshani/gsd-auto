# gsd-auto

Hands-free runner for the [GSD framework](https://www.npmjs.com/package/get-shit-done-cc) in Claude Code. Give it a range of phases and walk away — it plans, executes, and commits everything automatically, only stopping when it actually needs you (checkpoints, verification, decisions). Each plan runs in a fresh `claude -p` call so context never gets stale.

```powershell
.\gsd-auto.ps1 5 8                    # Plan + execute phases 5 through 8
.\gsd-auto.ps1 12 12                  # Finish phase 12 (skips completed plans)
.\gsd-auto.ps1 5 8 -DryRun            # Preview what would run
.\gsd-auto.ps1 5 8 -ProjectDir "C:\"  # Explicit project path
```

---

## Setup

### 1. Prerequisites

- **Windows** with PowerShell 5.1+
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** installed and in your PATH (`claude` must work from any terminal)
- **[GSD framework](https://www.npmjs.com/package/get-shit-done-cc)** installed in your project
- A GSD project with `.planning/` already initialized (at minimum: `PROJECT.md` and `ROADMAP.md` created via `/gsd:new-project` and `/gsd:create-roadmap`)

### 2. Get the script

```powershell
git clone https://github.com/rotemshoshani/gsd-auto.git
```

Place `gsd-auto.ps1` wherever you like:

```powershell
# Option A: In your project root
copy gsd-auto\gsd-auto.ps1 C:\path\to\your\project\

# Option B: Central location, reuse across projects
copy gsd-auto\gsd-auto.ps1 C:\Tools\gsd-auto\
```

### 3. Allow script execution (one-time)

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 4. Enable skip-permissions flag (one-time)

The script runs `claude -p` with `--dangerously-skip-permissions` for non-interactive execution. Add this to your project's `.claude/settings.json`:

```json
{ "permissions": { "allow-dangerously-skip-permissions": true } }
```

> **Note:** This bypasses all Claude Code permission prompts. Only use in projects you trust.

### 5. GSD config for automation

Set your `.planning/config.json` to skip GSD's workflow confirmations (which can't be answered in non-interactive `claude -p` sessions):

```json
{ "mode": "yolo" }
```

---

## How It Works

### The problem gsd-auto solves

Without this script, the GSD workflow for each plan is manual:

```
/gsd:plan-phase 5  →  /clear  →  /gsd:execute-plan 05-01  →  /clear  →  /gsd:execute-plan 05-02  →  /clear  →  ...
```

You need to `/clear` between each step because context accumulates and degrades quality. gsd-auto eliminates this entirely — each step is a separate `claude -p` call with a clean context window.

### What it does for each phase

```
For phase N in [StartPhase..EndPhase]:
  1. Find the phase directory (.planning/phases/N-*)
  2. If no PLAN.md files exist → run /gsd:plan-phase N
  3. For each PLAN.md (sorted by name):
     a. Skip if SUMMARY.md already exists (plan completed)
     b. Run: claude -p "/gsd:execute-plan <path>" --dangerously-skip-permissions
     c. Save full output to .planning/logs/auto/
     d. Scan output for checkpoint patterns
     e. If checkpoint found → pause, notify, wait for you
     f. If no SUMMARY.md after execution → warn, ask to continue
  4. Move to next phase
```

### Checkpoint detection

The script scans every `claude -p` output for these patterns that GSD uses to signal "stop and get a human":

| Pattern | Meaning |
|---------|---------|
| `CHECKPOINT REACHED` | Executor hit a formal checkpoint |
| `CHECKPOINT: Verification Required` | You need to visually test something |
| `CHECKPOINT: Action Required` | You need to do something manually (e.g. configure a service) |
| `CHECKPOINT: Decision Required` | You need to pick between options |
| `YOUR ACTION:` | Prompt line in any checkpoint type |
| `human_needed` | Verifier flagged items for human review |
| `gaps_found` | Verifier found unmet requirements |

When any pattern matches, the script:
1. Shows which pattern triggered the pause
2. Points you to the log file with the full Claude output
3. Sends a Windows toast notification (so you can walk away and get notified)
4. Waits for input: **Enter** to continue, **stop** to abort

### Checkpoint plans are detected before execution

GSD plans have an `autonomous: false` flag in their frontmatter when they contain checkpoints (human verification, decisions, manual actions). The script reads this **before** running `claude -p`.

When it finds a checkpoint plan, it **stops and tells you** to run it interactively:

```
  [2/3] 14:42:30  05-02-PLAN.md requires human verification

    This plan has a checkpoint that needs interactive execution.
    Run it in a Claude Code instance:

    /gsd:execute-plan .planning/phases/05-authentication/05-02-PLAN.md

    Then re-run gsd-auto to continue from where it left off.
```

**The workflow:**
1. The script stops (no wasted `claude -p` call)
2. Open a Claude Code instance and run the command it gives you
3. In the interactive session, Claude executes the auto tasks, presents the checkpoint, and you can approve/request fixes with full conversation context
4. After the plan completes (SUMMARY.md created), re-run gsd-auto — it skips everything already done and picks up at the next plan

### Logs

Every `claude -p` invocation is logged to `.planning/logs/auto/` inside your project:

```
.planning/logs/auto/
  phase5-plan-143022.log           # Planning output
  phase5-05-01-PLAN-143510.log     # Execution output per plan
  phase5-05-02-PLAN-144230.log
  ...
```

> **Security note:** Log files contain the full Claude output, which may include snippets of your source code, environment variables, or config values that Claude read during execution. Make sure `.planning/logs/` is in your project's `.gitignore` so logs are never committed. A sample `.gitignore` is included in this repo — copy the relevant lines into your project.

### Safe to re-run

The script checks for `SUMMARY.md` to determine if a plan is complete. If you re-run the same phase range, completed plans are skipped automatically. This means you can safely restart after a crash, an abort, or a checkpoint pause.

---

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `StartPhase` | Yes | First phase number to process |
| `EndPhase` | Yes | Last phase number to process (inclusive) |
| `-ProjectDir` | No | Path to GSD project root. Defaults to current directory |
| `-DryRun` | No | Preview what would run without executing anything |

---

## Example run

```
  GSD Auto-Runner
  ===============
  Phases:   5 -> 8
  Model:    opus
  Project:  C:\Users\admin\projects\myapp
  Stop:     echo stop > .planning\STOP  (from project root)

===========================================================
  PHASE 5
===========================================================
  Dir: 05-authentication
  Plans: 3

  [1/3] 14:35:10  Executing 05-01-PLAN.md...
    /gsd:execute-plan .planning/phases/05-authentication/05-01-PLAN.md
    Log: .planning\logs\auto\phase5-05-01-PLAN-143510.log
    Done. SUMMARY.md created.

  [2/3] 14:42:30  05-02-PLAN.md requires human verification

    This plan has a checkpoint that needs interactive execution.
    Run it in a Claude Code instance:

    /gsd:execute-plan .planning/phases/05-authentication/05-02-PLAN.md

    Then re-run gsd-auto to continue from where it left off.

===========================================================
  Stopped after 2 steps (00:12:08)
  Logs: .planning\logs\auto
===========================================================
```

After running the plan interactively and re-running gsd-auto:

```
  [1/3] SKIP 05-01-PLAN.md (already complete)
  [2/3] SKIP 05-02-PLAN.md (already complete)
  [3/3] 15:10:05  Executing 05-03-PLAN.md...
    ...
```

---

## Stopping a run

To stop gracefully after the current plan finishes, open another terminal, `cd` to the same project root, and run:

```powershell
echo stop > .planning\STOP
```

The script checks for this file before each plan. When found, it deletes the file and halts cleanly. Since the path is relative to the project, you can run gsd-auto on multiple projects simultaneously and stop them independently.

The stop hint is also shown in the startup banner as a reminder.

---

## Limitations

- **Windows only** — uses Windows toast notifications. The core logic works on any OS if you remove the `Send-Toast` function.
- **Sequential execution** — runs one plan at a time. For parallel execution within a phase, use `/gsd:execute-phase` directly in Claude Code.
- **Checkpoint plans require a separate step** — plans with `autonomous: false` are detected before execution and the script stops, telling you to run them interactively in Claude Code. Re-run gsd-auto afterward to continue.
