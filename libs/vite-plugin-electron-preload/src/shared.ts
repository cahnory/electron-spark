import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizePath, type ResolvedConfig } from "vite";

export const runtimeHelper = (name: string) => {
  const source = fileURLToPath(new URL(`./runtime/${name}.ts`, import.meta.url));
  return existsSync(source)
    ? source
    : fileURLToPath(new URL(`./runtime/${name}.js`, import.meta.url));
};

/** Each plugin owns its state but uses the same entry and bridge-key rules. */
export function preloadEntries(
  environmentName: string | { preloadPatterns: string | readonly string[] },
) {
  let root: string;
  let entries = new Set<string>();
  return {
    configure(config: ResolvedConfig) {
      root = config.root;
      if (typeof environmentName !== "string") return;
      const environment = config.environments[environmentName];
      if (!environment) throw new Error(`Unknown preload environment: ${environmentName}`);
      const input = environment.build.rolldownOptions.input ?? environment.input;
      const inputs =
        typeof input === "string"
          ? [input]
          : Array.isArray(input)
            ? input
            : Object.values(input ?? {});
      if (!inputs.length)
        throw new Error(`No inputs configured for preload environment: ${environmentName}`);
      entries = new Set(inputs.map((entry) => normalizePath(path.resolve(root, entry))));
    },
    resolve: (entry: string) => normalizePath(path.resolve(root, entry)),
    has: (id: string) =>
      typeof environmentName === "string"
        ? entries.has(normalizePath(id))
        : !id.startsWith("\0") &&
          ([] as readonly string[])
            .concat(environmentName.preloadPatterns)
            .some((pattern) => path.matchesGlob(normalizePath(path.relative(root, id)), pattern)),
    key: (id: string) => normalizePath(path.relative(root, id)),
  };
}
