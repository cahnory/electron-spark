import { EXPOSE_KEY, EXPOSED_PRELOADS_KEY } from "./common.ts";

export const getExposed = (preloadPath: string) => {
  const view = globalThis as Record<string, unknown>;
  const exposedPreloads = view[EXPOSED_PRELOADS_KEY];

  if (!exposedPreloads || !Object.hasOwn(exposedPreloads, preloadPath)) {
    throw new Error(
      `Preload "${preloadPath}" has not been loaded for this view. Configure this window's webPreferences.preload to load the corresponding preload.`,
    );
  }

  return view[EXPOSE_KEY];
};
