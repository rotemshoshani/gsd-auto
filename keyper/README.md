# Keyper

Keyper moves environment variables between local dotenv files, Convex deployments, and Vercel environments without printing their values. It exists so people and coding agents can perform routine secret operations without putting credentials in terminal output, command arguments, logs, or chat history.

Keyper can list names and portability status, but it has no command that displays a value.

## Setup

Requirements: Node.js 22+, an authenticated Convex CLI, and an authenticated Vercel CLI.

```sh
npm install
npm run build
npm link
```

Create the configuration:

```sh
cp .keyper.example.json .keyper.json
```

Define aliases for the locations you use. The file contains provider locations only—never credentials or secret values.

```json
{
  "version": 1,
  "aliases": {
    "local": { "provider": "local", "path": ".env.local" },
    "convex-dev": {
      "provider": "convex",
      "deployment": "team:project:dev/deployment-name"
    },
    "vercel-preview": {
      "provider": "vercel",
      "project": "my-app",
      "environment": "preview"
    }
  }
}
```

Check connectivity, then list the available names:

```sh
keyper doctor
keyper list --all
```

## Commands

```sh
# List names only
keyper list --all
keyper list --source local --json

# Copy and internally verify a value
keyper copy API_KEY --from local --to convex-dev

# Compare two values without displaying them
keyper compare API_KEY --between local convex-dev

# Move, verify, then delete the source
keyper move API_KEY --from local --to convex-dev \
  --confirm-delete-source API_KEY

# Install agent safety rules
keyper install-rules --project /path/to/repository
keyper install-rules --global
```

Useful options:

- `--config PATH` uses a different configuration file.
- `--to-name NAME` renames a variable at the destination.
- `--overwrite` permits replacing an existing destination.
- `--sensitive` creates a locked Vercel Sensitive variable.
- `--accept-unverified-source-deletion` is required when moving into locked Vercel storage.

## Safety model

Values stay inside Keyper processes and are transferred through private buffers or stdin. Output contains only names, aliases, portability, status, and sanitized error codes. A normal move deletes its source only after reading the destination and confirming equality internally.

Vercel Sensitive values become non-readable after creation. They can be written but cannot later be copied out or compared, so keep another canonical copy. Moving into Sensitive storage requires explicit acknowledgement before Keyper deletes the source.

`install-rules` adds Codex command rules and an `AGENTS.md` block that direct agents to use Keyper instead of raw secret-bearing commands.

## Matrix test

```sh
npm run test:matrix
```

The matrix test uses disposable real resources. It runs `copy`, `compare`, and verified `move` through all nine directed routes among local, Convex, and Vercel, plus Vercel portable/Sensitive behavior and a disposable deployment. Use `KEYPER_MATRIX_GROUP=routes1` (or another documented group in the test file) to run a bounded slice.
