# gsd-auto

Automated runner for the [GSD (Get Shit Done)](https://www.npmjs.com/package/get-shit-done-cc) framework in Claude Code. Plans and executes phases hands-free, only stopping when human input is actually needed.

## What it does

Without this script, the GSD workflow is manual:

```
/gsd:plan-phase 5      →  /clear  →  /gsd:execute-plan 05-01  →  /clear  →  /gsd:execute-plan 05-02  →  /clear  →  ...
```

This script automates that entire loop. For a given range of phases it will:

1. **Plan** the phase if no PLAN.md files exist yet
2. **Execute** each plan individually with a fresh context window (each `claude -p` call is isolated — no `/clear` needed)
3. **Skip** plans that already have a SUMMARY.md (safe to re-run)
4. **Pause** when GSD signals that human input is needed (checkpoints, verification, decisions)
5. **Notify** you with a Windows toast when it pauses or finishes

## Prerequisites

- **Windows** with PowerShell 5.1+
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** CLI installed and authenticated (`claude` must be in your PATH)
- **[GSD framework](https://www.npmjs.com/package/get-shit-done-cc)** installed (`npx get-shit-done-cc` in your project)
- A GSD project with `.planning/phases/` already set up (roadmap created)

## Setup

### 1. Download the script

Clone this repo or download `gsd-auto.ps1` directly:

```powershell
git clone https://github.com/rotemshoshani/gsd-auto.git
```

### 2. Place the script

Put `gsd-auto.ps1` somewhere convenient. Two options:

**Option A — In your project root** (simplest):
```powershell
copy gsd-auto\gsd-auto.ps1 C:\path\to\your\project\gsd-auto.ps1
```

**Option B — In a central location** (reuse across projects):
```powershell
copy gsd-auto\gsd-auto.ps1 C:\tools\gsd-auto.ps1
```

### 3. Allow script execution (one-time)

If you haven't already enabled PowerShell script execution:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### 4. Enable dangerous permissions flag (one-time)

The script runs `claude -p` with `--dangerously-skip-permissions` so it can execute non-interactively. You may need to enable this flag first. If you get a permissions error on first run, either:

- Add to your project's `.claude/settings.json`:
  ```json
  { "permissions": { "allow-dangerously-skip-permissions": true } }
  ```
- Or run in a sandboxed environment where this flag is enabled by default

> **Note:** This flag bypasses all Claude Code permission prompts. Only use it in projects you trust.

## Usage

Open PowerShell, `cd` into your GSD project root, and run:

```powershell
# Plan + execute phases 5 through 8
.\gsd-auto.ps1 5 8

# Just finish phase 12 (already partially done — skips completed plans)
.\gsd-auto.ps1 12 12

# Preview what would run without actually executing
.\gsd-auto.ps1 5 8 -DryRun

# Explicit project path (when script is not in the project dir)
.\gsd-auto.ps1 5 8 -ProjectDir "C:\path\to\your\project"
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `StartPhase` | Yes | First phase number to run |
| `EndPhase` | Yes | Last phase number to run (inclusive) |
| `-ProjectDir` | No | Path to GSD project root. Defaults to current directory |
| `-DryRun` | No | Preview what would run without executing |

## What happens during a run

```
  GSD Auto-Runner
  ===============
  Phases:   5 -> 8
  Model:    opus
  Project:  C:\my\project

===========================================================
  PHASE 5
===========================================================
  Dir: 05-authentication

  [1] 14:30:22  Planning phase 5...
    /gsd:plan-phase 5
    Log: .planning\logs\auto\phase5-plan-143022.log

  Plans: 3

  [1/3] 14:35:10  Executing 05-01-PLAN.md...
    /gsd:execute-plan .planning/phases/05-authentication/05-01-PLAN.md
    Log: .planning\logs\auto\phase5-05-01-PLAN-143510.log
    Done. SUMMARY.md created.

  [2/3] 14:42:30  Executing 05-02-PLAN.md...
    ...

  [3/3] SKIP 05-03-PLAN.md (already complete)

  Phase 5 complete!

===========================================================
  PHASE 6
  ...
```

## When it pauses

The script scans every `claude -p` output for GSD's structured checkpoint patterns:

| Pattern | Meaning |
|---------|---------|
| `CHECKPOINT REACHED` | Executor hit a formal checkpoint |
| `CHECKPOINT: Verification Required` | You need to test something |
| `CHECKPOINT: Action Required` | You need to do something (e.g. configure auth) |
| `CHECKPOINT: Decision Required` | You need to pick between options |
| `YOUR ACTION:` | Prompt line in any checkpoint type |
| `human_needed` | Post-phase verifier flagged items for human review |
| `gaps_found` | Post-phase verifier found unmet requirements |

When any of these match:
1. The script shows which pattern matched
2. Points you to the log file with the full output
3. Sends a Windows toast notification
4. Waits for you to press **Enter** to continue or type **stop** to abort

## Logs

Every `claude -p` call is logged to `.planning/logs/auto/` inside your project. Log files are named by step for easy reference:

```
.planning/logs/auto/
  phase5-plan-143022.log
  phase5-05-01-PLAN-143510.log
  phase5-05-02-PLAN-144230.log
  ...
```

## GSD config recommendations

For best results with automated execution, set these in your `.planning/config.json`:

```json
{
  "mode": "yolo",
  "gates": {
    "confirm_project": false,
    "confirm_phases": false,
    "confirm_roadmap": false,
    "confirm_breakdown": false,
    "confirm_plan": false,
    "execute_next_plan": false,
    "issues_review": false,
    "confirm_transition": false
  }
}
```

This prevents GSD from asking for confirmations that can't be answered in non-interactive mode.

## Limitations

- **Windows only** — uses Windows toast notifications (the core logic would work on macOS/Linux with the toast function removed)
- **Sequential execution** — runs one plan at a time. For parallel execution within a phase, use `/gsd:execute-phase` directly in Claude Code
- **No mid-plan resume** — if a plan fails partway through, re-running the script will attempt the full plan again (GSD's executor handles this gracefully via its continuation logic)
