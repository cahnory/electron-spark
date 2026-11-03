import path from "node:path";

export interface DependencyManifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export function packageDirectory(entry: string): string | undefined {
  return /^(node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*)\//.exec(
    entry,
  )?.[1];
}

/** Follow Node's ancestor lookup through the dependency graph actually shipped in ASAR. */
export async function packagedDependencies(
  entries: readonly string[],
  readManifest: (entry: string) => Promise<DependencyManifest>,
): Promise<Set<string>> {
  const manifests = new Set(entries);
  const visited = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    if (visited.has(directory)) return;
    visited.add(directory);
    const manifest = await readManifest(directory ? `${directory}/package.json` : "package.json");
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    await Promise.all(
      Object.keys(dependencies).map(async (name) => {
        if (!/^(@[a-z0-9_~-][a-z0-9._~-]*\/)?[a-z0-9_~-][a-z0-9._~-]*$/i.test(name)) {
          throw new Error(`Invalid dependency package name: ${name}`);
        }
        let ancestor = directory;
        while (true) {
          const candidate = path.posix.join(ancestor, "node_modules", name);
          if (
            path.posix.basename(ancestor) !== "node_modules" &&
            manifests.has(`${candidate}/package.json`)
          ) {
            return visit(candidate);
          }
          if (!ancestor) break;
          const parent = path.posix.dirname(ancestor);
          ancestor = parent === "." ? "" : parent;
        }
        if (
          Object.hasOwn(manifest.optionalDependencies ?? {}, name) ||
          (!Object.hasOwn(manifest.dependencies ?? {}, name) &&
            manifest.peerDependenciesMeta?.[name]?.optional)
        )
          return;
        throw new Error(
          `Missing packaged dependency: ${name} (required by ${directory || "application"})`,
        );
      }),
    );
  };
  await visit("");
  visited.delete("");
  return visited;
}
