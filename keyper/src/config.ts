import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { KeyperError } from "./errors.js";
import type { AliasConfig, LoadedConfig, KeyperConfig } from "./types.js";

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseAlias(value: unknown): AliasConfig {
  if (!value || typeof value !== "object") throw new KeyperError("CONFIG_INVALID");
  const candidate = value as Record<string, unknown>;
  if (candidate.provider === "local" && isNonEmptyString(candidate.path)) {
    return { provider: "local", path: candidate.path };
  }
  if (candidate.provider === "convex" && isNonEmptyString(candidate.deployment)) {
    return {
      provider: "convex",
      deployment: candidate.deployment,
      ...(isNonEmptyString(candidate.cwd) ? { cwd: candidate.cwd } : {})
    };
  }
  if (
    candidate.provider === "vercel" &&
    isNonEmptyString(candidate.project) &&
    isNonEmptyString(candidate.environment)
  ) {
    return {
      provider: "vercel",
      project: candidate.project,
      environment: candidate.environment,
      ...(isNonEmptyString(candidate.scope) ? { scope: candidate.scope } : {}),
      ...(isNonEmptyString(candidate.gitBranch) ? { gitBranch: candidate.gitBranch } : {})
    };
  }
  throw new KeyperError("CONFIG_INVALID");
}

export async function loadConfig(path = ".keyper.json"): Promise<LoadedConfig> {
  const configPath = resolve(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    throw new KeyperError("CONFIG_INVALID");
  }
  if (!parsed || typeof parsed !== "object") throw new KeyperError("CONFIG_INVALID");
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.aliases || typeof candidate.aliases !== "object") {
    throw new KeyperError("CONFIG_INVALID");
  }
  const aliases: Record<string, AliasConfig> = {};
  for (const [name, value] of Object.entries(candidate.aliases as Record<string, unknown>)) {
    if (!ALIAS_PATTERN.test(name)) throw new KeyperError("CONFIG_INVALID");
    const alias = parseAlias(value);
    if (alias.provider === "local") {
      alias.path = isAbsolute(alias.path) ? alias.path : resolve(dirname(configPath), alias.path);
    }
    if (alias.provider === "convex" && alias.cwd) {
      alias.cwd = isAbsolute(alias.cwd) ? alias.cwd : resolve(dirname(configPath), alias.cwd);
    }
    aliases[name] = alias;
  }
  if (Object.keys(aliases).length === 0) throw new KeyperError("CONFIG_INVALID");
  const config: KeyperConfig = { version: 1, aliases };
  return { config, configPath, baseDir: dirname(configPath) };
}

export function requireName(name: string): string {
  if (!NAME_PATTERN.test(name)) throw new KeyperError("NAME_INVALID");
  return name;
}

export function requireAlias(config: KeyperConfig, alias: string): AliasConfig {
  const result = config.aliases[alias];
  if (!result) throw new KeyperError("ALIAS_NOT_FOUND");
  return result;
}
