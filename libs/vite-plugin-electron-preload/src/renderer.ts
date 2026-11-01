import { readFile } from "node:fs/promises";

import { transformWithOxc, type Plugin } from "vite";

import { preloadEntries, runtimeHelper } from "./shared.ts";

const getHelper = runtimeHelper("getExposed");

/** Replace renderer imports of preload entries with getter-backed exports. */
export function electronPreloadRenderer(environmentName = "preload"): Plugin {
  const entries = preloadEntries(environmentName);
  return {
    name: `@electron-start/vite-plugin-electron-preload:renderer:${environmentName}`,
    enforce: "pre",
    configResolved: (config) => entries.configure(config),
    async load(id) {
      if (this.environment.config.consumer !== "client" || !entries.has(id)) return null;

      // Inspect the source without adding its implementation or Node dependencies
      // to the renderer graph. Type-only exports disappear before inspection.
      const visited = new Set<string>();
      const exportsOf = async (file: string): Promise<Set<string>> => {
        if (visited.has(file)) return new Set();
        visited.add(file);
        this.addWatchFile(file);
        const source = await readFile(file, "utf8");
        const { code } = await transformWithOxc(source, file);
        const ast = this.parse(code);
        const names = new Set<string>();
        await ast.body.reduce(async (previous, node) => {
          await previous;
          if (node.type === "ExportDefaultDeclaration") names.add("default");
          if (node.type === "ExportNamedDeclaration") {
            for (const specifier of node.specifiers) {
              names.add(
                specifier.exported.type === "Identifier"
                  ? specifier.exported.name
                  : specifier.exported.value,
              );
            }
            const declaration = node.declaration;
            if (declaration?.type === "VariableDeclaration") {
              for (const variable of declaration.declarations) bindingNames(variable.id, names);
            } else if (
              declaration &&
              "id" in declaration &&
              declaration.id &&
              "name" in declaration.id
            ) {
              names.add(declaration.id.name);
            }
          }
          if (node.type === "ExportAllDeclaration") {
            if (node.exported) {
              names.add(
                node.exported.type === "Identifier" ? node.exported.name : node.exported.value,
              );
            } else {
              const resolved = await this.resolve(node.source.value, file, {
                skipSelf: true,
              });
              if (!resolved || resolved.external)
                throw new Error(
                  `Cannot inspect preload re-export ${node.source.value} from ${file}`,
                );
              for (const name of await exportsOf(resolved.id))
                if (name !== "default") names.add(name);
            }
          }
        }, Promise.resolve());
        return names;
      };
      const names = await exportsOf(id);
      return `import { getExposed } from ${JSON.stringify(getHelper)};
const exposed = getExposed(${JSON.stringify(entries.key(id))});
${[...names].map((name, index) => `const value${index} = exposed[${JSON.stringify(name)}]; export { value${index} as ${JSON.stringify(name)} };`).join("\n")}`;
    },
  };
}

// The binding subset shared by identifiers and destructuring patterns.
type Binding = {
  type: string;
  name?: string;
  left?: Binding;
  argument?: Binding;
  elements?: (Binding | null)[];
  properties?: { type: string; value?: Binding | null; argument?: Binding }[];
};
function bindingNames(binding: Binding, names: Set<string>): void {
  if (binding.type === "Identifier") names.add(binding.name!);
  if (binding.left) bindingNames(binding.left, names);
  if (binding.argument) bindingNames(binding.argument, names);
  for (const element of binding.elements ?? []) if (element) bindingNames(element, names);
  for (const property of binding.properties ?? []) {
    const value = property.type === "RestElement" ? property.argument : property.value;
    if (value) bindingNames(value, names);
  }
}
