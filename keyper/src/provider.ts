import type { AliasConfig, KeyProvider } from "./types.js";
import { ConvexProvider } from "./providers/convex.js";
import { LocalProvider } from "./providers/local.js";
import { VercelProvider } from "./providers/vercel.js";

export function createProvider(config: AliasConfig): KeyProvider {
  switch (config.provider) {
    case "local":
      return new LocalProvider(config.path);
    case "convex":
      return new ConvexProvider(config.deployment, config.cwd);
    case "vercel":
      return new VercelProvider(config);
  }
}
