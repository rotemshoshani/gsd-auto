import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { KeyperError } from "../errors.js";
import { runSafeProcess } from "../safe-process.js";
import type { InventoryEntry, KeyProvider, WriteOptions } from "../types.js";

function convexInvocation(): { command: string; prefix: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("convex/package.json");
    const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { bin?: string | Record<string, string> };
    const relative = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.convex;
    if (!relative) throw new Error("missing bin");
    return { command: process.execPath, prefix: [join(dirname(packagePath), relative)] };
  } catch {
    throw new KeyperError("PROVIDER_UNAVAILABLE");
  }
}

function trimCommandTerminator(value: Buffer): Buffer {
  let end = value.length;
  if (end > 0 && value[end - 1] === 0x0a) end -= 1;
  const result = Buffer.from(value.subarray(0, end));
  value.fill(0);
  return result;
}

export class ConvexProvider implements KeyProvider {
  readonly kind = "convex" as const;

  constructor(
    private readonly deployment: string,
    private readonly cwd?: string
  ) {}

  private async run(args: string[], input?: Buffer): Promise<Buffer> {
    const invocation = convexInvocation();
    return await runSafeProcess(
      invocation.command,
      [...invocation.prefix, "env", "--deployment", this.deployment, ...args],
      { ...(this.cwd ? { cwd: this.cwd } : {}), ...(input ? { input } : {}) }
    );
  }

  async list(): Promise<InventoryEntry[]> {
    const output = await this.run(["list", "--names-only"]);
    try {
      return output
        .toString("utf8")
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, portability: "portable" as const }))
        .sort((left, right) => left.name.localeCompare(right.name));
    } finally {
      output.fill(0);
    }
  }

  async read(name: string): Promise<Buffer> {
    const entries = await this.list();
    if (!entries.some((entry) => entry.name === name)) throw new KeyperError("SOURCE_MISSING");
    return trimCommandTerminator(await this.run(["get", name]));
  }

  async write(name: string, value: Buffer, options: WriteOptions): Promise<{ verifiable: boolean }> {
    const exists = (await this.list()).some((entry) => entry.name === name);
    if (exists && !options.overwrite) throw new KeyperError("DESTINATION_EXISTS");
    const output = await this.run(["set", name], value);
    output.fill(0);
    return { verifiable: true };
  }

  async remove(name: string): Promise<void> {
    const output = await this.run(["remove", name]);
    output.fill(0);
  }

  async doctor(): Promise<void> {
    const output = await this.run(["list", "--names-only"]);
    output.fill(0);
  }
}
