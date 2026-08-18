export type Portability = "portable" | "locked";

export interface LocalAlias {
  provider: "local";
  path: string;
}

export interface ConvexAlias {
  provider: "convex";
  deployment: string;
  cwd?: string;
}

export interface VercelAlias {
  provider: "vercel";
  project: string;
  scope?: string;
  environment: string;
  gitBranch?: string;
}

export type AliasConfig = LocalAlias | ConvexAlias | VercelAlias;

export interface KeyperConfig {
  version: 1;
  aliases: Record<string, AliasConfig>;
}

export interface InventoryEntry {
  name: string;
  portability: Portability;
}

export interface WriteOptions {
  overwrite: boolean;
  sensitive: boolean;
}

export interface KeyProvider {
  readonly kind: AliasConfig["provider"];
  list(): Promise<InventoryEntry[]>;
  read(name: string): Promise<Buffer>;
  write(name: string, value: Buffer, options: WriteOptions): Promise<{ verifiable: boolean }>;
  remove(name: string): Promise<void>;
  doctor(): Promise<void>;
}

export interface LoadedConfig {
  config: KeyperConfig;
  configPath: string;
  baseDir: string;
}
