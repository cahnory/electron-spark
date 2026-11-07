import { contextBridge } from "electron";

import { EXPOSE_KEY } from "./common.ts";

/** Expose the complete per-view registry once, after all preload modules initialize. */
export const exposeToRenderer = <const T extends Record<string, Record<string, unknown>>>(
  preloads: T,
): T => {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld(EXPOSE_KEY, preloads);
  } else {
    (globalThis as Record<string, unknown>)[EXPOSE_KEY] = preloads;
  }
  return preloads;
};
