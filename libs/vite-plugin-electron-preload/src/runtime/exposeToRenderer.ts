import { contextBridge } from "electron";

import { EXPOSE_KEY, EXPOSED_PRELOADS_KEY } from "./common.ts";

let isolatedBridge: Record<string, unknown> | undefined;
const exposedPreloads: Record<string, true> = {};

export const exposeToRenderer = <const T extends Record<string, unknown>>(
  toExpose: T,
  preloadPath: string,
): T => {
  isolatedBridge ??= {};
  Object.assign(isolatedBridge, toExpose);

  /**
   * Use `contextBridge` APIs to expose Electron APIs to
   * renderer only if context isolation is enabled, otherwise
   * just add to the DOM global.
   */
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld(EXPOSE_KEY, isolatedBridge);
    exposedPreloads[preloadPath] = true;
    contextBridge.exposeInMainWorld(EXPOSED_PRELOADS_KEY, exposedPreloads);
  } else {
    (globalThis as Record<string, unknown>)[EXPOSE_KEY] ??= isolatedBridge;
    exposedPreloads[preloadPath] = true;
    (globalThis as Record<string, unknown>)[EXPOSED_PRELOADS_KEY] = exposedPreloads;
  }

  return toExpose;
};
