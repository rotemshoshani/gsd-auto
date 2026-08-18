import { randomBytes, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keyper } from "../src/core.js";
import { KeyperError } from "../src/errors.js";
import type { AliasConfig, InventoryEntry, KeyProvider, WriteOptions } from "../src/types.js";

class FakeProvider implements KeyProvider {
  readonly values = new Map<string, { value: Buffer; locked: boolean }>();

  constructor(readonly kind: AliasConfig["provider"]) {}

  async list(): Promise<InventoryEntry[]> {
    return [...this.values].map(([name, value]) => ({
      name,
      portability: value.locked ? "locked" : "portable"
    }));
  }

  async read(name: string): Promise<Buffer> {
    const entry = this.values.get(name);
    if (!entry) throw new KeyperError("SOURCE_MISSING");
    if (entry.locked) throw new KeyperError("VALUE_LOCKED");
    return Buffer.from(entry.value);
  }

  async write(name: string, value: Buffer, options: WriteOptions): Promise<{ verifiable: boolean }> {
    if (this.values.has(name) && !options.overwrite) throw new KeyperError("DESTINATION_EXISTS");
    this.values.set(name, { value: Buffer.from(value), locked: options.sensitive });
    return { verifiable: !options.sensitive };
  }

  async remove(name: string): Promise<void> {
    if (!this.values.delete(name)) throw new KeyperError("SOURCE_MISSING");
  }

  async doctor(): Promise<void> {}
}

function fixture(): {
  keyper: Keyper;
  source: FakeProvider;
  destination: FakeProvider;
} {
  const sourceConfig: AliasConfig = { provider: "local", path: "/unused-a" };
  const destinationConfig: AliasConfig = {
    provider: "vercel",
    project: "test",
    environment: "preview"
  };
  const source = new FakeProvider("local");
  const destination = new FakeProvider("vercel");
  const providers = new Map<AliasConfig, FakeProvider>([
    [sourceConfig, source],
    [destinationConfig, destination]
  ]);
  const keyper = new Keyper(
    { version: 1, aliases: { source: sourceConfig, destination: destinationConfig } },
    (config) => providers.get(config)!
  );
  return { keyper, source, destination };
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

describe("Keyper", () => {
  it("copies and verifies a portable value", async () => {
    const { keyper, source, destination } = fixture();
    const value = randomBytes(48);
    source.values.set("API_KEY", { value: Buffer.from(value), locked: false });
    const result = await keyper.copy({
      name: "API_KEY",
      from: "source",
      to: "destination",
      overwrite: false,
      sensitive: false
    });
    expect(result.verified).toBe(true);
    expect(buffersEqual(destination.values.get("API_KEY")!.value, value)).toBe(true);
    value.fill(0);
  });

  it("deletes a source only after verified move", async () => {
    const { keyper, source } = fixture();
    const value = randomBytes(48);
    source.values.set("API_KEY", { value, locked: false });
    await keyper.move({
      name: "API_KEY",
      from: "source",
      to: "destination",
      overwrite: false,
      sensitive: false,
      confirmDeleteSource: "API_KEY",
      acceptUnverifiedSourceDeletion: false
    });
    expect(source.values.has("API_KEY")).toBe(false);
  });

  it("requires acknowledgement before writing a sensitive move", async () => {
    const { keyper, source, destination } = fixture();
    source.values.set("API_KEY", { value: randomBytes(48), locked: false });
    await expect(keyper.move({
      name: "API_KEY",
      from: "source",
      to: "destination",
      overwrite: false,
      sensitive: true,
      confirmDeleteSource: "API_KEY",
      acceptUnverifiedSourceDeletion: false
    })).rejects.toMatchObject({ code: "UNVERIFIED_DELETE_REQUIRES_ACK" });
    expect(destination.values.has("API_KEY")).toBe(false);
    expect(source.values.has("API_KEY")).toBe(true);
  });

  it("refuses to read a locked source", async () => {
    const { keyper, source } = fixture();
    source.values.set("API_KEY", { value: randomBytes(48), locked: true });
    await expect(keyper.copy({
      name: "API_KEY",
      from: "source",
      to: "destination",
      overwrite: false,
      sensitive: false
    })).rejects.toMatchObject({ code: "VALUE_LOCKED" });
  });

  it("refuses a same-name copy to the same resolved location", async () => {
    const alias: AliasConfig = { provider: "local", path: "/same" };
    const provider = new FakeProvider("local");
    provider.values.set("API_KEY", { value: randomBytes(48), locked: false });
    const keyper = new Keyper(
      { version: 1, aliases: { first: alias, second: { ...alias } } },
      () => provider
    );
    await expect(keyper.copy({
      name: "API_KEY",
      from: "first",
      to: "second",
      overwrite: true,
      sensitive: false
    })).rejects.toMatchObject({ code: "SAME_LOCATION" });
    expect(provider.values.has("API_KEY")).toBe(true);
  });
});
