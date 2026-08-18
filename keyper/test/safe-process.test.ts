import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runSafeProcess } from "../src/safe-process.js";

describe("runSafeProcess", () => {
  it("suppresses child stdout and stderr on failure", async () => {
    const canary = randomBytes(64);
    const script = "const b=[];process.stdin.on('data',c=>b.push(c));process.stdin.on('end',()=>{const v=Buffer.concat(b);process.stdout.write(v);process.stderr.write(v);process.exit(1)})";
    let message = "";
    try {
      await runSafeProcess(process.execPath, ["-e", script], { input: canary });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe("The provider operation failed. Provider output was suppressed.");
    expect(Buffer.from(message).includes(canary)).toBe(false);
    canary.fill(0);
  });
});
