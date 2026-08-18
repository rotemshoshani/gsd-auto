#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { asSafeError, KeyperError } from "./errors.js";
import { installGuardrails } from "./guardrails.js";
import { Keyper } from "./core.js";

const USAGE = `Usage:
  keyper list [--source ALIAS | --all] [--json] [--config PATH]
  keyper copy NAME --from ALIAS --to ALIAS [--to-name NAME] [--overwrite] [--sensitive] [--config PATH]
  keyper compare NAME --between ALIAS ALIAS [--config PATH]
  keyper move NAME --from ALIAS --to ALIAS --confirm-delete-source NAME [--to-name NAME] [--overwrite] [--sensitive] [--accept-unverified-source-deletion] [--config PATH]
  keyper doctor [--json] [--config PATH]
  keyper install-rules (--project PATH | --global)`;

interface ParsedArgs {
  positionals: string[];
  options: Map<string, string | true>;
  pairs: Map<string, [string, string]>;
}

const BOOLEAN_OPTIONS = new Set([
  "--all",
  "--json",
  "--overwrite",
  "--sensitive",
  "--accept-unverified-source-deletion",
  "--global"
]);

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  const pairs = new Map<string, [string, string]>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? "";
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(value)) {
      options.set(value, true);
      continue;
    }
    if (value === "--between") {
      const left = args[index + 1];
      const right = args[index + 2];
      if (!left || !right || left.startsWith("--") || right.startsWith("--")) usageError();
      pairs.set(value, [left, right]);
      index += 2;
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) usageError();
    options.set(value, next);
    index += 1;
  }
  return { positionals, options, pairs };
}

function usageError(): never {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 2;
  throw new Error("usage");
}

function option(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function flag(parsed: ParsedArgs, name: string): boolean {
  return parsed.options.get(name) === true;
}

function assertOptions(parsed: ParsedArgs, allowed: readonly string[], allowedPairs: readonly string[] = []): void {
  const optionSet = new Set(allowed);
  const pairSet = new Set(allowedPairs);
  if (
    [...parsed.options.keys()].some((name) => !optionSet.has(name)) ||
    [...parsed.pairs.keys()].some((name) => !pairSet.has(name))
  ) usageError();
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const parsed = parseArgs(rest);
  if (command === "install-rules") {
    assertOptions(parsed, ["--global", "--project"]);
    const global = flag(parsed, "--global");
    const project = option(parsed, "--project");
    if (global === Boolean(project) || parsed.positionals.length > 0) usageError();
    await installGuardrails({ global, ...(project ? { project } : {}) });
    process.stdout.write(`installed agent guardrails (${global ? "global" : "project"})\n`);
    return;
  }

  const loaded = await loadConfig(option(parsed, "--config"));
  const keyper = new Keyper(loaded.config);

  if (command === "list") {
    assertOptions(parsed, ["--source", "--all", "--json", "--config"]);
    if (parsed.positionals.length > 0) usageError();
    const source = option(parsed, "--source");
    if (source && flag(parsed, "--all")) usageError();
    const inventory = source
      ? { [source]: await keyper.inventory(source) }
      : await keyper.inventoryAll();
    if (flag(parsed, "--json")) {
      printJson(inventory);
    } else {
      for (const [alias, entries] of Object.entries(inventory)) {
        for (const entry of entries) process.stdout.write(`${alias}\t${entry.name}\t${entry.portability}\n`);
      }
    }
    return;
  }

  if (command === "copy" || command === "move") {
    assertOptions(parsed, command === "copy"
      ? ["--from", "--to", "--to-name", "--overwrite", "--sensitive", "--config"]
      : ["--from", "--to", "--to-name", "--overwrite", "--sensitive", "--confirm-delete-source", "--accept-unverified-source-deletion", "--config"]);
    const name = parsed.positionals[0];
    const from = option(parsed, "--from");
    const to = option(parsed, "--to");
    if (!name || parsed.positionals.length !== 1 || !from || !to) usageError();
    const toName = option(parsed, "--to-name");
    const request = {
      name,
      from,
      to,
      ...(toName ? { toName } : {}),
      overwrite: flag(parsed, "--overwrite"),
      sensitive: flag(parsed, "--sensitive")
    };
    const result = command === "copy"
      ? await keyper.copy(request)
      : await keyper.move({
          ...request,
          confirmDeleteSource: option(parsed, "--confirm-delete-source") ?? "",
          acceptUnverifiedSourceDeletion: flag(parsed, "--accept-unverified-source-deletion")
        });
    process.stdout.write(`${command === "copy" ? "copied" : "moved"}\t${name}\t${from}\t${to}\t${result.verified ? "verified" : "unverified"}\n`);
    return;
  }

  if (command === "compare") {
    assertOptions(parsed, ["--config"], ["--between"]);
    const name = parsed.positionals[0];
    const between = parsed.pairs.get("--between");
    if (!name || parsed.positionals.length !== 1 || !between) usageError();
    const result = await keyper.compare(name, between[0], between[1]);
    process.stdout.write(`${result}\n`);
    if (result !== "equal") process.exitCode = 4;
    return;
  }

  if (command === "doctor") {
    assertOptions(parsed, ["--json", "--config"]);
    if (parsed.positionals.length > 0) usageError();
    const result = await keyper.doctor();
    if (flag(parsed, "--json")) printJson(result);
    else for (const [alias, status] of Object.entries(result)) process.stdout.write(`${alias}\t${status}\n`);
    if (Object.values(result).includes("failed")) process.exitCode = 5;
    return;
  }

  usageError();
}

run().catch((error: unknown) => {
  if (process.exitCode === 2) return;
  const safe = error instanceof KeyperError ? error : asSafeError(error);
  process.stderr.write(`error ${safe.code}: ${safe.message}\n`);
  process.exitCode = 5;
});
