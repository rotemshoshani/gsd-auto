import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { KeyperError } from "../errors.js";
import { runSafeProcess } from "../safe-process.js";
import type { InventoryEntry, KeyProvider, VercelAlias, WriteOptions } from "../types.js";

const READ_HELPER = [
  "const n=process.argv[1];",
  "if(!Object.prototype.hasOwnProperty.call(process.env,n))process.exit(42);",
  "process.stdout.write(process.env[n]??'');"
].join("");

const contextDirectories = new Set<string>();
let cleanupRegistered = false;

interface VercelContext {
  directory: string;
  orgId: string;
  projectId: string;
}

interface VercelInventoryEntry extends InventoryEntry {
  id?: string;
}

function registerContextCleanup(directory: string): void {
  contextDirectories.add(directory);
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", () => {
    for (const path of contextDirectories) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // Context contains project metadata only and is safe to leave for OS temp cleanup.
      }
    }
  });
}

function extractEntries(value: unknown): VercelInventoryEntry[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).find(Array.isArray) ?? []
      : [];
  const entries: VercelInventoryEntry[] = [];
  for (const candidate of candidates as unknown[]) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const name = typeof record.key === "string"
      ? record.key
      : typeof record.name === "string"
        ? record.name
        : undefined;
    if (!name) continue;
    const locked = record.sensitive === true || record.type === "sensitive";
    const id = typeof record.id === "string" ? record.id : undefined;
    entries.push({ name, portability: locked ? "locked" : "portable", ...(id ? { id } : {}) });
  }
  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

export class VercelProvider implements KeyProvider {
  readonly kind = "vercel" as const;
  private inventoryCache: VercelInventoryEntry[] | undefined;
  private contextPromise: Promise<VercelContext> | undefined;

  constructor(private readonly config: VercelAlias) {}

  private async context(): Promise<VercelContext> {
    if (!this.contextPromise) {
      this.contextPromise = (async () => {
        const directory = await mkdtemp(join(tmpdir(), "keyper-vercel-"));
        await chmod(directory, 0o700);
        try {
          const output = await runSafeProcess("vercel", [
            "link",
            "--yes",
            "--project",
            this.config.project,
            "--cwd",
            directory,
            "--non-interactive",
            "--no-color",
            ...(this.config.scope ? ["--scope", this.config.scope] : [])
          ]);
          output.fill(0);
          const metadataBytes = await readFile(join(directory, ".vercel", "project.json"));
          try {
            const metadata = JSON.parse(metadataBytes.toString("utf8")) as Record<string, unknown>;
            if (typeof metadata.orgId !== "string" || typeof metadata.projectId !== "string") {
              throw new KeyperError("PROVIDER_FAILED");
            }
            registerContextCleanup(directory);
            return { directory, orgId: metadata.orgId, projectId: metadata.projectId };
          } finally {
            metadataBytes.fill(0);
          }
        } catch {
          rmSync(directory, { recursive: true, force: true });
          throw new KeyperError("PROVIDER_FAILED");
        }
      })();
    }
    return await this.contextPromise;
  }

  private async contextArgs(): Promise<string[]> {
    const context = await this.context();
    return ["--cwd", context.directory, "--non-interactive", "--no-color"];
  }

  private async accessToken(): Promise<string> {
    const environmentToken = process.env.VERCEL_TOKEN;
    if (environmentToken) return environmentToken;
    const dataRoot = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const candidates = [
      join(dataRoot, "com.vercel.cli", "auth.json"),
      join(configRoot, "vercel", "auth.json"),
      join(homedir(), "Library", "Application Support", "com.vercel.cli", "auth.json")
    ];
    for (const path of candidates) {
      let bytes: Buffer | undefined;
      try {
        bytes = await readFile(path);
        const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        if (typeof parsed.token === "string" && parsed.token.length > 0) return parsed.token;
      } catch {
        // Try the next documented CLI credential location without exposing details.
      } finally {
        bytes?.fill(0);
      }
    }
    throw new KeyperError("PROVIDER_AUTH");
  }

  private async apiRequest(
    apiVersion: string,
    suffix: string,
    init: { method: "POST" | "PATCH" | "DELETE"; body?: Buffer }
  ): Promise<void> {
    const context = await this.context();
    const token = await this.accessToken();
    const url = new URL(`https://api.vercel.com/${apiVersion}/projects/${encodeURIComponent(context.projectId)}/env${suffix}`);
    url.searchParams.set("teamId", context.orgId);
    let response: Response;
    const body = init.body ? Uint8Array.from(init.body).buffer : undefined;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {})
        },
        ...(body ? { body } : {})
      });
    } catch {
      throw new KeyperError("PROVIDER_FAILED");
    } finally {
      if (body) new Uint8Array(body).fill(0);
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) throw new KeyperError("PROVIDER_AUTH");
    if (response.status === 409) throw new KeyperError("DESTINATION_EXISTS");
    if (response.status === 400 || response.status === 422) throw new KeyperError("CONFIG_INVALID");
    throw new KeyperError("PROVIDER_FAILED");
  }

  private targetArgs(): string[] {
    return [this.config.environment, ...(this.config.gitBranch ? [this.config.gitBranch] : [])];
  }

  async list(): Promise<InventoryEntry[]> {
    if (this.inventoryCache) return this.inventoryCache.map(({ name, portability }) => ({ name, portability }));
    const context = await this.contextArgs();
    const output = await runSafeProcess("vercel", [
      "env",
      "list",
      ...this.targetArgs(),
      "--format",
      "json",
      ...context
    ]);
    try {
      this.inventoryCache = extractEntries(JSON.parse(output.toString("utf8")));
      return this.inventoryCache.map(({ name, portability }) => ({ name, portability }));
    } catch {
      throw new KeyperError("PROVIDER_FAILED");
    } finally {
      output.fill(0);
    }
  }

  async read(name: string): Promise<Buffer> {
    await this.list();
    const entry = this.inventoryCache?.find((candidate) => candidate.name === name);
    if (!entry) throw new KeyperError("SOURCE_MISSING");
    if (entry.portability === "locked") throw new KeyperError("VALUE_LOCKED");
    const context = await this.contextArgs();
    return await runSafeProcess("vercel", [
      "env",
      "run",
      "-e",
      this.config.environment,
      ...(this.config.gitBranch ? ["--git-branch", this.config.gitBranch] : []),
      ...context,
      "--",
      process.execPath,
      "-e",
      READ_HELPER,
      name
    ]);
  }

  async write(name: string, value: Buffer, options: WriteOptions): Promise<{ verifiable: boolean }> {
    if (options.sensitive && !["preview", "production"].includes(this.config.environment)) {
      throw new KeyperError("CONFIG_INVALID");
    }
    await this.list();
    const entry = this.inventoryCache?.find((candidate) => candidate.name === name);
    if (entry && !options.overwrite) throw new KeyperError("DESTINATION_EXISTS");
    if (entry?.portability === "locked" && !options.sensitive) {
      throw new KeyperError("DESTINATION_LOCKED");
    }
    const requestBody = Buffer.from(JSON.stringify({
      key: name,
      value: value.toString("utf8"),
      type: options.sensitive ? "sensitive" : "encrypted",
      target: [this.config.environment],
      ...(this.config.gitBranch ? { gitBranch: this.config.gitBranch } : {})
    }), "utf8");
    try {
      await this.apiRequest(
        "v10",
        entry ? "?upsert=true" : "",
        { method: "POST", body: requestBody }
      );
    } finally {
      requestBody.fill(0);
    }
    if (!entry) {
      this.inventoryCache = undefined;
      const refreshed = await this.list();
      if (!refreshed.some((candidate) => candidate.name === name)) {
        throw new KeyperError("PROVIDER_FAILED");
      }
    } else {
      const remaining = (this.inventoryCache ?? []).filter((candidate) => candidate.name !== name);
      remaining.push({
        name,
        portability: options.sensitive ? "locked" : "portable",
        ...(entry.id ? { id: entry.id } : {})
      });
      this.inventoryCache = remaining.sort((left, right) => left.name.localeCompare(right.name));
    }
    return { verifiable: !options.sensitive && entry?.portability !== "locked" };
  }

  async remove(name: string): Promise<void> {
    if (this.config.gitBranch) throw new KeyperError("CONFIG_INVALID");
    await this.list();
    const entry = this.inventoryCache?.find((candidate) => candidate.name === name);
    if (!entry) throw new KeyperError("SOURCE_MISSING");
    const context = await this.contextArgs();
    const output = await runSafeProcess("vercel", [
      "env",
      "remove",
      name,
      ...this.targetArgs(),
      "--yes",
      ...context
    ]);
    output.fill(0);
    this.inventoryCache = (this.inventoryCache ?? []).filter((entry) => entry.name !== name);
  }

  async doctor(): Promise<void> {
    await this.list();
  }
}
