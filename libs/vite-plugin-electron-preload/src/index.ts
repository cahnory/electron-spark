import { buildOnServe } from "@electron-start/vite-plugin-build-on-serve";
import type { Plugin } from "vite";

import { electronPreloadExpose } from "./expose.ts";
import { electronPreloadRenderer } from "./renderer.ts";

export { electronPreloadExpose, electronPreloadRenderer };

/** Expose preload exports, replace renderer imports, and build preloads during dev. */
export function electronPreload(environmentName = "preload"): Plugin[] {
  return [
    electronPreloadExpose(environmentName),
    electronPreloadRenderer(environmentName),
    buildOnServe(environmentName),
  ];
}
