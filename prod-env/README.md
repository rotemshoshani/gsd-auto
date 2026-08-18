# prod-env

`prod-env` opens a tmux dashboard containing the production monitors declared
by the current repository's `.rsh-utils.json`. One monitor uses the full area,
two are stacked, and three or more use tmux's tiled layout.

Install the command by symlinking it onto your path:

```bash
ln -s ~/projects/utilities/prod-env/prod-env ~/.local/bin/prod-env
```

## Configuration

Add a `prod_env` section to `.rsh-utils.json`. Between one and nine panes are
supported, and titles must be unique.

```json
{
  "version": 1,
  "prod_env": {
    "panes": [
      {
        "type": "convex",
        "title": "Convex errors",
        "deployment": "beloved-terrier-619",
        "log_mode": "errors",
        "history": 500
      },
      {
        "type": "vercel",
        "title": "Vercel production",
        "project": "meniv-crm",
        "target": "production",
        "poll_seconds": 30,
        "error_log_lines": 120
      },
      {
        "type": "command",
        "title": "Other service",
        "command": "service-cli logs --errors"
      }
    ]
  }
}
```

Convex `log_mode` can be `errors` or `all`. Error-level entries and thrown
failures are red; all-mode warnings are yellow, debug output is dim, and
successful completions are green. Vercel panes show deployment state and only
fetch build logs when the latest matching deployment failed. `scope` is an
optional Vercel pane field for repositories that are not already linked to the
correct organization.

Command panes run trusted configuration through Bash in the repository root.
Do not put credentials or other secrets in `.rsh-utils.json`.

## Controls

- `1`–`9`: restart that monitor
- `A`: restart every monitor
- `Q`: close the dashboard
