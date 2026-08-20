# herdr-space

An fzf picker over Herdr workspace presets. Pick one, and it opens a workspace
with the tabs you defined and starts each tab's command.

```
herdr-space              # fzf picker over every preset
herdr-space server       # launch a preset by name, no picker
herdr-space --list       # print preset names
herdr-space --describe server
```

Running a preset whose workspace is already open focuses it instead of opening a
second copy — so `herdr-space server` is safe to run whenever, and doubles as
"take me to my server space".

## Presets

A preset is a `*.json` file **in this directory**, next to the script. The
filename (minus `.json`) is the name you type; `label` is the workspace label
Herdr shows in the sidebar, and the key used to decide whether it is already open.

```json
{
  "version": 1,
  "label": "server",
  "cwd": "~/projects/meniv/crm",
  "tabs": [
    { "label": "meniv-prod", "command": "prod-env" },
    { "label": "meniv-dev",  "command": "dev-env" },
    { "label": "newsletter", "cwd": "~/projects/misc/daily-newsletter/scripts",
      "command": "bash newsletter-loop.sh" }
  ]
}
```

| field | required | meaning |
|---|---|---|
| `label` | yes | workspace label; also the already-open key |
| `cwd` | no | default working directory for tabs (`~` and `$VARS` expand) |
| `tabs` | yes | one entry per tab, opened in order |
| `tabs[].label` | yes | tab label; must be unique within the preset |
| `tabs[].cwd` | no | overrides the preset `cwd` |
| `tabs[].command` | no | typed into the tab's shell; omit for a plain shell |
| `version` | no | must be `1` |

Every `cwd` is checked before anything is created, so a typo fails loudly
instead of leaving a half-built workspace.

## Commands run in an interactive shell

Each command is typed into the tab's live interactive bash, not `exec`'d. That
is deliberate: it means a preset can call **shell functions and aliases from
`~/.bashrc`**, not just binaries on `PATH`. `prod-env` in `server.json` is
exactly that — a bashrc function. The tradeoff is that presets depend on your
shell config; a command that resolves in your terminal will resolve here.

Because the commands run from the repo directory rather than carrying flags,
`dev-env` and `prod-env` pick up that project's own `.rsh-utils.json` — see the
[repo README](../README.md#project-local-launcher-config).

## Included presets

### `server.json`
The long-running Meniv CRM box: `prod-env` (Convex errors + Vercel status),
`dev-env` (`npx convex dev` + `npm run dev:agent`), and the daily newsletter
send loop.

## Requirements

`herdr` and `fzf` on `PATH`, and a running Herdr server. The script does not
have to run from inside a Herdr pane — it talks to the server over its socket.

## Tests

```bash
python3 -m pytest herdr-space/tests -q
```
