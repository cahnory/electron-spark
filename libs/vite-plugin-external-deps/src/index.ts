import { readFileSync } from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

export type ExternalDepsOptions = {
  /** Defaults to Vite's root. Set this when source and package roots differ. */
  projectDir?: string;
  /** Apply only to this environment; otherwise apply to every server environment. */
  environment?: string;
  /** Additional package names to externalize. */
  include?: readonly string[];
  /** Package names to leave to the remaining resolver/bundler configuration. */
  exclude?: readonly string[];
};

/** Preserve the package layout of declared runtime dependencies. */
export function externalDeps(options: ExternalDepsOptions = {}): Plugin {
  let manifest: string;
  let packages = new Set<string>();
  return {
    name: "@electron-spark/vite-plugin-external-deps",
    enforce: "pre",
    applyToEnvironment: (environment) =>
      options.environment
        ? environment.name === options.environment
        : environment.config.consumer === "server",
    configResolved(config) {
      manifest = path.resolve(options.projectDir ?? config.root, "package.json");
    },
    buildStart() {
      this.addWatchFile(manifest);
      let pkg: {
        dependencies?: Record<string, unknown>;
        optionalDependencies?: Record<string, unknown>;
      };
      try {
        pkg = JSON.parse(readFileSync(manifest, "utf8"));
      } catch (error) {
        // A source-only fixture/project may have no manifest; malformed manifests are errors.
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        pkg = {};
      }
      packages = new Set(
        [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.optionalDependencies ?? {}),
          ...(options.include ?? []),
        ].filter((name) => !options.exclude?.includes(name)),
      );
    },
    resolveId(id) {
      if (id.startsWith(".") || id.startsWith("/") || id.startsWith("\0")) return null;
      const name = id.startsWith("@") ? id.split("/").slice(0, 2).join("/") : id.split("/")[0];
      return packages.has(name) ? { id, external: true } : null;
    },
  };
}
