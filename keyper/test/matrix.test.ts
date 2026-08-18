import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Keyper } from "../src/core.js";
import { KeyperError } from "../src/errors.js";
import { createProvider } from "../src/provider.js";
import { runSafeProcess } from "../src/safe-process.js";
import type { AliasConfig, KeyperConfig } from "../src/types.js";

const enabled = process.env.KEYPER_MATRIX_TESTS === "1";
const group = process.env.KEYPER_MATRIX_GROUP ?? "all";
const convexTeam = process.env.KEYPER_CONVEX_TEAM ?? "shoshani-rotem";
const vercelScope = process.env.KEYPER_VERCEL_SCOPE;
const runId = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const convexProject = "keyper-matrix";
const vercelProject = `keyper-matrix-${runId}`;
const createdCanaries: Buffer[] = [];

let directory = "";
let config: KeyperConfig;
let keyper: Keyper;
let providers: Map<AliasConfig, ReturnType<typeof createProvider>>;
let vercelCreated = false;

function convexCommand(args: string[], input?: Buffer): Promise<Buffer> {
  return runSafeProcess(
    process.execPath,
    [resolve("node_modules/convex/bin/main.js"), ...args],
    input ? { input } : {}
  );
}

async function discard(promise: Promise<Buffer>): Promise<void> {
  const output = await promise;
  output.fill(0);
}

async function setupStep(label: string, promise: Promise<Buffer>): Promise<void> {
  try {
    await discard(promise);
  } catch {
    throw new Error(`integration setup failed: ${label}`);
  }
}

async function operationStep<T>(label: string, promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error: unknown) {
    if (error instanceof KeyperError) throw new Error(`integration operation failed: ${label}: ${error.code}`);
    throw new Error(`integration operation failed: ${label}`);
  }
}

function makeCanary(): Buffer {
  const value = Buffer.from(randomBytes(48).toString("base64url"), "utf8");
  createdCanaries.push(value);
  return value;
}

async function seed(alias: string, name: string, value: Buffer): Promise<void> {
  await providers.get(config.aliases[alias]!)!.write(name, value, {
    overwrite: false,
    sensitive: false
  });
}

async function exerciseRoutes(routes: Array<[string, string]>, offset: number): Promise<void> {
  for (let index = 0; index < routes.length; index += 1) {
    const [from, to] = routes[index]!;
    const name = `KEYPER_ROUTE_${index + offset}_${runId.replaceAll("-", "_").toUpperCase()}`;
    const value = makeCanary();
    await seed(from, name, value);
    const result = await keyper.copy({
      name,
      from,
      to,
      overwrite: false,
      sensitive: false
    });
    expect(result.verified).toBe(true);
    expect(await keyper.compare(name, from, to)).toBe("equal");

    const moved = await keyper.move({
      name,
      from,
      to,
      overwrite: true,
      sensitive: false,
      confirmDeleteSource: name,
      acceptUnverifiedSourceDeletion: false
    });
    expect(moved.verified).toBe(true);
    expect((await keyper.inventory(from)).some((entry) => entry.name === name)).toBe(false);
    expect((await keyper.inventory(to)).some((entry) => entry.name === name)).toBe(true);
  }

  const cliOutput = await runSafeProcess(process.execPath, [
    resolve("dist/cli.js"),
    "list",
    "--all",
    "--json",
    "--config",
    join(directory, ".keyper.json")
  ]);
  try {
    for (const canary of createdCanaries) expect(cliOutput.includes(canary)).toBe(false);
  } finally {
    cliOutput.fill(0);
  }
}

describe.runIf(enabled)("keyper matrix test", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "keyper-matrix-test-"));
    const localA = join(directory, "a.env");
    const localB = join(directory, "b.env");
    await writeFile(localA, "", { mode: 0o600 });
    await writeFile(localB, "", { mode: 0o600 });

    const projectReference = convexTeam ? `${convexTeam}:${convexProject}` : convexProject;
    const convexAReference = `${projectReference}:dev/${runId}-a`;
    const convexBReference = `${projectReference}:dev/${runId}-b`;
    if (!group.startsWith("vercel-")) {
      try {
        await discard(convexCommand([
          "project",
          "create",
          convexProject,
          ...(convexTeam ? ["--team", convexTeam] : [])
        ]));
      } catch {
        // The dedicated fixture project is intentionally reusable.
      }
      await setupStep("convex-deployment-a", convexCommand([
        "deployment",
        "create",
        convexAReference,
        "--type",
        "dev",
        "--expiration",
        "in 1 day"
      ]));
      await setupStep("convex-deployment-b", convexCommand([
        "deployment",
        "create",
        convexBReference,
        "--type",
        "dev",
        "--expiration",
        "in 1 day"
      ]));
    }

    await setupStep("vercel-project", runSafeProcess("vercel", [
      "project",
      "add",
      vercelProject,
      "--non-interactive",
      "--no-color",
      ...(vercelScope ? ["--scope", vercelScope] : [])
    ]));
    vercelCreated = true;

    const vercelBase = {
      provider: "vercel" as const,
      project: vercelProject,
      ...(vercelScope ? { scope: vercelScope } : {})
    };
    const aliases: Record<string, AliasConfig> = {
      localA: { provider: "local", path: localA },
      localB: { provider: "local", path: localB },
      convexA: { provider: "convex", deployment: convexAReference },
      convexB: { provider: "convex", deployment: convexBReference },
      vercelA: { ...vercelBase, environment: "development" },
      vercelB: { ...vercelBase, environment: "preview" }
    };
    config = { version: 1, aliases };
    providers = new Map(Object.values(aliases).map((alias) => [alias, createProvider(alias)]));
    keyper = new Keyper(config, (alias) => providers.get(alias)!);
    await writeFile(join(directory, ".keyper.json"), JSON.stringify(config), { mode: 0o600 });
  });

  afterAll(async () => {
    for (const canary of createdCanaries) canary.fill(0);
    if (vercelCreated) {
      try {
        await discard(runSafeProcess("vercel", [
          "project",
          "remove",
          vercelProject,
          "--yes",
          "--non-interactive",
          "--no-color",
          ...(vercelScope ? ["--scope", vercelScope] : [])
        ]));
      } catch {
        await discard(runSafeProcess("vercel", [
          "project",
          "remove",
          vercelProject,
          "--non-interactive",
          "--no-color",
          ...(vercelScope ? ["--scope", vercelScope] : [])
        ], { input: Buffer.from("y\n") })).catch(() => undefined);
      }
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.runIf(group === "all" || group === "routes1")("runs the three same-provider routes", async () => {
    await exerciseRoutes([
      ["localA", "localB"],
      ["convexA", "convexB"],
      ["vercelA", "vercelB"]
    ], 0);
  });

  it.runIf(group === "all" || group === "routes2")("runs the first three cross-provider routes", async () => {
    await exerciseRoutes([
      ["localA", "convexA"],
      ["convexA", "localA"],
      ["localA", "vercelA"]
    ], 3);
  });

  it.runIf(group === "all" || group === "routes3")("runs the remaining three cross-provider routes", async () => {
    await exerciseRoutes([
      ["vercelA", "localA"],
      ["convexA", "vercelA"],
      ["vercelA", "convexA"]
    ], 6);
  });

  it.runIf(group === "all" || group === "vercel-portable")("round-trips a portable Vercel value", async () => {
    const portableName = `KEYPER_VERCEL_${runId.replaceAll("-", "_").toUpperCase()}`;
    const value = makeCanary();
    const vercel = providers.get(config.aliases.vercelA!)!;
    await operationStep("vercel-inventory", vercel.list());
    await operationStep("vercel-write", vercel.write(portableName, value, {
      overwrite: false,
      sensitive: false
    }));
    const fetched = await operationStep("vercel-read", vercel.read(portableName));
    try {
      expect(fetched.length === value.length && timingSafeEqual(fetched, value)).toBe(true);
    } finally {
      fetched.fill(0);
    }
    await expect(vercel.write(portableName, makeCanary(), {
      overwrite: false,
      sensitive: false
    })).rejects.toMatchObject({ code: "DESTINATION_EXISTS" });
    const replacement = makeCanary();
    await operationStep("vercel-update", vercel.write(portableName, replacement, {
      overwrite: true,
      sensitive: false
    }));
    const updated = await operationStep("vercel-read-updated", vercel.read(portableName));
    try {
      expect(updated.length === replacement.length && timingSafeEqual(updated, replacement)).toBe(true);
    } finally {
      updated.fill(0);
    }
    expect((await keyper.copy({
      name: portableName,
      from: "vercelA",
      to: "localB",
      overwrite: false,
      sensitive: false
    })).verified).toBe(true);

  });

  it.runIf(group === "all" || group === "vercel-sensitive")("locks a Vercel Sensitive value", async () => {
    const sensitiveName = `KEYPER_VERCEL_LOCKED_${runId.replaceAll("-", "_").toUpperCase()}`;
    const vercel = providers.get(config.aliases.vercelB!)!;
    await operationStep("vercel-sensitive-inventory", vercel.list());
    await operationStep("vercel-sensitive-write", vercel.write(sensitiveName, makeCanary(), {
      overwrite: false,
      sensitive: true
    }));
    await operationStep("vercel-sensitive-update", vercel.write(sensitiveName, makeCanary(), {
      overwrite: true,
      sensitive: true
    }));
    expect((await keyper.inventory("vercelB")).find((entry) => entry.name === sensitiveName)?.portability).toBe("locked");
  });

  it.runIf(group === "all" || group === "moves")("handles verified and explicitly unverified moves", async () => {
    const standardName = `KEYPER_MOVE_${runId.replaceAll("-", "_").toUpperCase()}`;
    await seed("localA", standardName, makeCanary());
    const standard = await keyper.move({
      name: standardName,
      from: "localA",
      to: "convexB",
      overwrite: false,
      sensitive: false,
      confirmDeleteSource: standardName,
      acceptUnverifiedSourceDeletion: false
    });
    expect(standard.verified).toBe(true);
    expect((await keyper.inventory("localA")).some((entry) => entry.name === standardName)).toBe(false);

    const sensitiveName = `KEYPER_SENSITIVE_${runId.replaceAll("-", "_").toUpperCase()}`;
    await seed("localA", sensitiveName, makeCanary());
    const sensitive = await keyper.move({
      name: sensitiveName,
      from: "localA",
      to: "vercelB",
      overwrite: false,
      sensitive: true,
      confirmDeleteSource: sensitiveName,
      acceptUnverifiedSourceDeletion: true
    });
    expect(sensitive.verified).toBe(false);
    expect((await keyper.inventory("localA")).some((entry) => entry.name === sensitiveName)).toBe(false);
    expect((await keyper.inventory("vercelB")).find((entry) => entry.name === sensitiveName)?.portability).toBe("locked");
    await expect(keyper.copy({
      name: sensitiveName,
      from: "vercelB",
      to: "localB",
      overwrite: false,
      sensitive: false
    })).rejects.toMatchObject({ code: "VALUE_LOCKED" });
  });

  it.runIf(group === "all" || group === "moves" || group === "vercel-deploy")("triggers a disposable Vercel deployment without waiting", async () => {
    await setupStep("vercel-deploy", runSafeProcess("vercel", [
      "deploy",
      resolve("test/fixtures/vercel-app"),
      "--yes",
      "--no-wait",
      "--project",
      vercelProject,
      "--non-interactive",
      "--no-color",
      ...(vercelScope ? ["--scope", vercelScope] : [])
    ]));
  });
});
