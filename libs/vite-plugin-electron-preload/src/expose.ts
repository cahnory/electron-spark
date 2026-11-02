import type { Plugin } from "vite";

import { preloadEntries, runtimeHelper } from "./shared.ts";

const wrapperPrefix = "\0electron-preload:";
const exposeHelper = runtimeHelper("exposeToRenderer");

/** Wrap preload build entries so their exports are exposed to the renderer. */
export function electronPreloadExpose(environmentName = "preload"): Plugin {
  const entries = preloadEntries(environmentName);
  const wrap = (entry: string) => wrapperPrefix + entries.resolve(entry);
  return {
    name: `@electron-spark/vite-plugin-electron-preload:expose:${environmentName}`,
    enforce: "pre",
    configResolved: (config) => entries.configure(config),
    options(options) {
      if (this.environment.name !== environmentName) return null;
      const input = options.input;
      return {
        ...options,
        input:
          typeof input === "string"
            ? wrap(input)
            : Array.isArray(input)
              ? input.map(wrap)
              : Object.fromEntries(
                  Object.entries(input ?? {}).map(([name, entry]) => [name, wrap(entry)]),
                ),
      };
    },
    resolveId(id) {
      if (
        this.environment.name === environmentName &&
        (id === "electron" || id.startsWith("electron/"))
      )
        return { id, external: true };
      return this.environment.name === environmentName && id.startsWith(wrapperPrefix) ? id : null;
    },
    load(id) {
      if (this.environment.name === environmentName && id.startsWith(wrapperPrefix)) {
        const source = id.slice(wrapperPrefix.length);
        return `import * as exposed from ${JSON.stringify(source)};
import { exposeToRenderer } from ${JSON.stringify(exposeHelper)};
exposeToRenderer(exposed, ${JSON.stringify(entries.key(source))});`;
      }
      return null;
    },
  };
}
