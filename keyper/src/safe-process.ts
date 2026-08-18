import { spawn } from "node:child_process";
import { KeyperError, type ErrorCode } from "./errors.js";

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

export interface SafeProcessOptions {
  cwd?: string;
  input?: Buffer;
  env?: NodeJS.ProcessEnv;
  classifyFailure?: (stderr: Buffer, stdout: Buffer) => ErrorCode;
}

export async function runSafeProcess(
  command: string,
  args: readonly string[],
  options: SafeProcessOptions = {}
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    let stdoutSize = 0;
    let stderrSize = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const fail = (code: "PROVIDER_UNAVAILABLE" | "PROVIDER_FAILED") => {
      if (settled) return;
      settled = true;
      for (const chunk of stdout) chunk.fill(0);
      for (const chunk of stderr) chunk.fill(0);
      reject(new KeyperError(code));
    };

    child.on("error", () => fail("PROVIDER_UNAVAILABLE"));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        fail("PROVIDER_FAILED");
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        fail("PROVIDER_FAILED");
        return;
      }
      stderr.push(Buffer.from(chunk));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const errorOutput = Buffer.concat(stderr);
        const standardOutput = Buffer.concat(stdout);
        let errorCode: ErrorCode = "PROVIDER_FAILED";
        try {
          errorCode = options.classifyFailure?.(errorOutput, standardOutput) ?? "PROVIDER_FAILED";
        } catch {
          errorCode = "PROVIDER_FAILED";
        } finally {
          errorOutput.fill(0);
          standardOutput.fill(0);
          for (const chunk of stderr) chunk.fill(0);
        }
        for (const chunk of stdout) chunk.fill(0);
        reject(new KeyperError(errorCode));
        return;
      }
      for (const chunk of stderr) chunk.fill(0);
      const output = Buffer.concat(stdout);
      for (const chunk of stdout) chunk.fill(0);
      resolve(output);
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
