import { buildOnServe } from "@electron-spark/vite-plugin-build-on-serve";
import type { Plugin } from "vite";

import { electronPreloadExpose } from "./expose.ts";
import { electronPreloadRenderer } from "./renderer.ts";

export { electronPreloadExpose, electronPreloadRenderer };

/** Expose preload exports, replace renderer imports, and build preloads during dev. */
export function electronPreload(environmentName = "preload"): Plugin[] {
  return [
    electronPreloadExpose(environmentName),
    electronPreloadRenderer(environmentName),
    buildOnServe(environmentName, {
      session(server) {
        return {
          buildSuccess() {
            // The bridge lives in the preload context, so renderer HMR cannot replace it.
            server.ws.send({ type: "full-reload" });
          },
          async close() {},
        };
      },
    }),
  ];
}

export {
  electronPreloadViews,
  type PreloadView,
  type ElectronPreloadViewsOptions,
} from "./views.ts";
