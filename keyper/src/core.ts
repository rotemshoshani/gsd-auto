import { timingSafeEqual } from "node:crypto";
import { requireAlias, requireName } from "./config.js";
import { KeyperError } from "./errors.js";
import { createProvider } from "./provider.js";
import type { InventoryEntry, KeyperConfig } from "./types.js";

export interface CopyRequest {
  name: string;
  from: string;
  to: string;
  toName?: string;
  overwrite: boolean;
  sensitive: boolean;
}

export interface MoveRequest extends CopyRequest {
  confirmDeleteSource: string;
  acceptUnverifiedSourceDeletion: boolean;
}

export type CompareResult = "equal" | "different" | "missing" | "locked";

export type ProviderFactory = (config: Parameters<typeof createProvider>[0]) => ReturnType<typeof createProvider>;

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function sameLocation(left: ReturnType<typeof requireAlias>, right: ReturnType<typeof requireAlias>): boolean {
  if (left.provider !== right.provider) return false;
  if (left.provider === "local" && right.provider === "local") return left.path === right.path;
  if (left.provider === "convex" && right.provider === "convex") {
    return left.deployment === right.deployment && left.cwd === right.cwd;
  }
  if (left.provider === "vercel" && right.provider === "vercel") {
    return left.project === right.project &&
      left.scope === right.scope &&
      left.environment === right.environment &&
      left.gitBranch === right.gitBranch;
  }
  return false;
}

export class Keyper {
  private readonly providers = new Map<string, ReturnType<ProviderFactory>>();

  constructor(
    private readonly config: KeyperConfig,
    private readonly providerFactory: ProviderFactory = createProvider
  ) {}

  private provider(alias: string): ReturnType<ProviderFactory> {
    const existing = this.providers.get(alias);
    if (existing) return existing;
    const created = this.providerFactory(requireAlias(this.config, alias));
    this.providers.set(alias, created);
    return created;
  }

  async inventory(alias: string): Promise<InventoryEntry[]> {
    return await this.provider(alias).list();
  }

  async inventoryAll(): Promise<Record<string, InventoryEntry[]>> {
    const result: Record<string, InventoryEntry[]> = {};
    for (const alias of Object.keys(this.config.aliases).sort()) {
      result[alias] = await this.inventory(alias);
    }
    return result;
  }

  async compare(name: string, leftAlias: string, rightAlias: string): Promise<CompareResult> {
    requireName(name);
    const left = this.provider(leftAlias);
    const right = this.provider(rightAlias);
    const leftEntry = (await left.list()).find((entry) => entry.name === name);
    const rightEntry = (await right.list()).find((entry) => entry.name === name);
    if (!leftEntry || !rightEntry) return "missing";
    if (leftEntry.portability === "locked" || rightEntry.portability === "locked") return "locked";
    let leftValue: Buffer | undefined;
    let rightValue: Buffer | undefined;
    try {
      leftValue = await left.read(name);
      rightValue = await right.read(name);
      return equalBuffers(leftValue, rightValue) ? "equal" : "different";
    } finally {
      leftValue?.fill(0);
      rightValue?.fill(0);
    }
  }

  async copy(request: CopyRequest): Promise<{ verified: boolean; destinationName: string }> {
    const sourceName = requireName(request.name);
    const destinationName = requireName(request.toName ?? request.name);
    const sourceConfig = requireAlias(this.config, request.from);
    const destinationConfig = requireAlias(this.config, request.to);
    if (sourceName === destinationName && sameLocation(sourceConfig, destinationConfig)) {
      throw new KeyperError("SAME_LOCATION");
    }
    const source = this.provider(request.from);
    const destination = this.provider(request.to);
    if (request.sensitive && destinationConfig.provider !== "vercel") {
      throw new KeyperError("CONFIG_INVALID");
    }
    let value: Buffer | undefined;
    let verification: Buffer | undefined;
    try {
      value = await source.read(sourceName);
      const { verifiable } = await destination.write(destinationName, value, {
        overwrite: request.overwrite,
        sensitive: request.sensitive
      });
      if (!verifiable) return { verified: false, destinationName };
      verification = await destination.read(destinationName);
      if (!equalBuffers(value, verification)) throw new KeyperError("VALUES_DIFFER");
      return { verified: true, destinationName };
    } finally {
      value?.fill(0);
      verification?.fill(0);
    }
  }

  async move(request: MoveRequest): Promise<{ verified: boolean; destinationName: string }> {
    if (request.confirmDeleteSource !== request.name) {
      throw new KeyperError("CONFIRMATION_REQUIRED");
    }
    const destinationConfig = requireAlias(this.config, request.to);
    if (
      request.sensitive &&
      destinationConfig.provider === "vercel" &&
      !request.acceptUnverifiedSourceDeletion
    ) {
      throw new KeyperError("UNVERIFIED_DELETE_REQUIRES_ACK");
    }
    const result = await this.copy(request);
    if (!result.verified && !request.acceptUnverifiedSourceDeletion) {
      throw new KeyperError("UNVERIFIED_DELETE_REQUIRES_ACK");
    }
    const source = this.provider(request.from);
    await source.remove(requireName(request.name));
    return result;
  }

  async doctor(): Promise<Record<string, "ok" | "failed">> {
    const result: Record<string, "ok" | "failed"> = {};
    for (const alias of Object.keys(this.config.aliases).sort()) {
      try {
        await this.provider(alias).doctor();
        result[alias] = "ok";
      } catch {
        result[alias] = "failed";
      }
    }
    return result;
  }
}
