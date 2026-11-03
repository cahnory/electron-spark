import MagicString from "magic-string";
import type { Plugin } from "vite";

export type EsmShimOptions = {
  /** Apply only to this environment; otherwise apply to every server environment. */
  environment?: string;
};

type Node = { type: string; [key: string]: unknown };

function isNode(value: unknown): value is Node {
  return (
    value !== null && typeof value === "object" && "type" in value && typeof value.type === "string"
  );
}

function nodes(value: unknown): Node[] {
  return Array.isArray(value) ? value.filter(isNode) : [];
}

/** Collect module bindings, including hoisted var declarations inside blocks. */
function bindings(program: unknown): Set<string> {
  const names = new Set<string>();
  function pattern(node: unknown) {
    if (!isNode(node)) return;
    if (node.type === "Identifier") {
      if (typeof node.name === "string") names.add(node.name);
    } else if (node.type === "RestElement") pattern(node.argument);
    else if (node.type === "AssignmentPattern") pattern(node.left);
    else if (node.type === "ArrayPattern") nodes(node.elements).forEach(pattern);
    else if (node.type === "ObjectPattern")
      for (const prop of nodes(node.properties)) {
        pattern(prop.type === "RestElement" ? prop.argument : prop.value);
      }
  }
  function visit(node: unknown, topLevel: boolean) {
    if (!isNode(node)) return;
    if (node.type === "ImportDeclaration") {
      for (const spec of nodes(node.specifiers)) pattern(spec.local);
      return;
    }
    if (
      [
        "FunctionDeclaration",
        "ClassDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "ClassExpression",
      ].includes(node.type)
    ) {
      if (topLevel) pattern(node.id);
      return;
    }
    if (node.type === "VariableDeclaration" && (topLevel || node.kind === "var")) {
      for (const decl of nodes(node.declarations)) pattern(decl.id);
    }
    for (const value of Object.values(node)) {
      const children = Array.isArray(value) ? value : [value];
      for (const child of children)
        if (isNode(child)) {
          visit(child, node.type === "Program" || (topLevel && node.type.startsWith("Export")));
        }
    }
  }
  visit(program, false);
  return names;
}

/** Supply CommonJS convenience bindings in Node ESM chunks without changing globals. */
export function esmShim(options: EsmShimOptions = {}): Plugin {
  return {
    name: "@electron-spark/vite-plugin-esm-shim",
    applyToEnvironment: (environment) =>
      options.environment
        ? environment.name === options.environment
        : environment.config.consumer === "server",
    renderChunk(code, _chunk, output) {
      if (output.format !== "es") return null;
      const declared = bindings(this.parse(code));
      const lines: string[] = [];
      let prefix = "__electronSparkShim";
      while (code.includes(prefix)) prefix += "_";
      if (!declared.has("require"))
        lines.push(
          `import { createRequire as ${prefix}Require } from "node:module";`,
          `var require = ${prefix}Require(import.meta.url);`,
        );
      if (!declared.has("__filename") || !declared.has("__dirname"))
        lines.push(`import { fileURLToPath as ${prefix}File } from "node:url";`);
      if (!declared.has("__filename"))
        lines.push(`var __filename = ${prefix}File(import.meta.url);`);
      if (!declared.has("__dirname"))
        lines.push(
          `import { dirname as ${prefix}Dir } from "node:path";`,
          `var __dirname = ${prefix}Dir(${prefix}File(import.meta.url));`,
        );
      if (!lines.length) return null;
      const result = new MagicString(code);
      const offset = code.startsWith("#!") ? code.indexOf("\n") + 1 : 0;
      result.appendLeft(offset, lines.join("\n") + "\n");
      return { code: result.toString(), map: result.generateMap({ hires: true }) };
    },
  };
}
