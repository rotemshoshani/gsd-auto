import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProvider } from "../src/providers/local.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

async function temporaryPath(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "keyper-local-test-"));
  temporaryDirectories.push(directory);
  return join(directory, name);
}

function equal(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

describe("LocalProvider", () => {
  it("round-trips complex values while preserving comments", async () => {
    const path = await temporaryPath("fixture.env");
    await writeFile(path, "# retained\nUNCHANGED=value\n", { mode: 0o600 });
    const provider = new LocalProvider(path);
    const value = Buffer.from(`${randomBytes(32).toString("base64")}\n'\"\\suffix`, "utf8");
    await provider.write("API_KEY", value, { overwrite: false, sensitive: false });
    const received = await provider.read("API_KEY");
    expect(equal(received, value)).toBe(true);
    const raw = await readFile(path);
    try {
      expect(raw.includes(Buffer.from("# retained"))).toBe(true);
      expect((await provider.list()).map((entry) => entry.name)).toEqual(["API_KEY", "UNCHANGED"]);
    } finally {
      raw.fill(0);
      received.fill(0);
      value.fill(0);
    }
  });

  it("refuses duplicate names", async () => {
    const path = await temporaryPath("duplicate.env");
    await writeFile(path, "DUPLICATE=one\nDUPLICATE=two\n", { mode: 0o600 });
    await expect(new LocalProvider(path).list()).rejects.toMatchObject({ code: "LOCAL_FILE_INVALID" });
  });

  it("refuses symlink targets", async () => {
    const target = await temporaryPath("target.env");
    const link = join(target, "..", "link.env");
    await writeFile(target, "NAME=value\n", { mode: 0o600 });
    await symlink(target, link);
    await expect(new LocalProvider(link).list()).rejects.toMatchObject({ code: "LOCAL_FILE_UNSAFE" });
  });
});
