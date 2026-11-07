import { EXPOSE_KEY } from "./common.ts";

export const getExposed = (preloadPath: string) => {
  // This registry is installed by the generated preload before renderer execution.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const preloads = (globalThis as Record<string, unknown>)[EXPOSE_KEY] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!preloads || !Object.hasOwn(preloads, preloadPath)) {
    throw new Error(
      `Preload "${preloadPath}" has not been loaded for this view. Rebuild the view's generated preload and reload the window.`,
    );
  }
  return preloads[preloadPath];
};
