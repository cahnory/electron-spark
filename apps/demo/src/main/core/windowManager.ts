import { pathToFileURL } from "node:url";

import { BrowserWindow, type BrowserWindowConstructorOptions, shell } from "electron";

type NavigationOptions = {
  /** Open external HTTP(S) links in the browser, or silently block them. Defaults to "open". */
  externalLinks?: "open" | "block" | undefined;
};

type RendererSettings<K extends string = string> =
  | {
      mode: "serve";
      renderers: Record<K, { url: string; window: BrowserWindowConstructorOptions }>;
    }
  | {
      mode: "build";
      renderers: Record<K, { path: string; window: BrowserWindowConstructorOptions }>;
    };
type RendererOptions = NavigationOptions &
  (
    | { mode: "serve"; url: string; window: BrowserWindowConstructorOptions }
    | { mode: "build"; path: string; window: BrowserWindowConstructorOptions }
  );

export const createRenderer = <const K extends string>(options: RendererSettings<K>) => {
  const create = (name: K, navigation: NavigationOptions = {}) =>
    createWindowManager(
      options.mode === "build"
        ? {
            ...navigation,
            mode: "build",
            path: options.renderers[name].path,
            window: options.renderers[name].window,
          }
        : {
            ...navigation,
            mode: "serve",
            url: options.renderers[name].url,
            window: options.renderers[name].window,
          },
    );

  return { create };
};

const createWindowManager = (options: RendererOptions) => {
  const rendererUrl = options.mode === "serve" ? new URL(options.url) : pathToFileURL(options.path);
  let win: BrowserWindow | undefined;
  let loading: Promise<void> = Promise.resolve();

  const has = () => !!win && !win.isDestroyed();
  const get = () => (has() ? win : undefined);

  const create = (): BrowserWindow => {
    const activeWindow = get();
    if (activeWindow) {
      return activeWindow;
    }

    const windowInstance = new BrowserWindow({
      ...options.window,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        ...options.window.webPreferences,
      },
    });

    win = windowInstance;

    windowInstance.on("ready-to-show", () => {
      if (windowInstance === get()) {
        windowInstance.show();
      }
    });

    setNavigationPolicy(windowInstance, rendererUrl, options.externalLinks ?? "open");

    loading = (
      options.mode === "serve"
        ? windowInstance.loadURL(options.url)
        : windowInstance.loadFile(options.path)
    ).catch((error: unknown) => {
      if (!windowInstance.isDestroyed()) windowInstance.destroy();
      if (win === windowInstance) win = undefined;
      throw error;
    });

    return win;
  };

  const focus = (): void => {
    const activeWindow = get();

    if (activeWindow) {
      if (activeWindow.isMinimized()) {
        activeWindow.restore();
      }

      activeWindow.focus();
    }
  };

  return {
    ready: () => loading,
    has,
    focus,
    get,
    create,
  };
};

// Keep this window on its renderer document and manage external links explicitly.
const setNavigationPolicy = (
  win: BrowserWindow,
  rendererUrl: URL,
  externalLinks: NonNullable<NavigationOptions["externalLinks"]>,
): void => {
  const isInternal = (url: URL): boolean =>
    url.protocol === rendererUrl.protocol &&
    url.host === rendererUrl.host &&
    url.username === rendererUrl.username &&
    url.password === rendererUrl.password &&
    url.pathname === rendererUrl.pathname;

  const openExternal = (url: URL | undefined): void => {
    if (
      externalLinks === "open" &&
      url &&
      (url.protocol === "https:" || url.protocol === "http:")
    ) {
      shell.openExternal(url.href).catch((): void => {
        console.error(`Error while opening external url: ${url.href}`);
      });
    }
  };

  const handleNavigation = (event: { url: string; preventDefault(): void }): void => {
    const url = parseUrl(event.url);
    if (url && isInternal(url)) {
      return;
    }
    event.preventDefault();
    openExternal(url);
  };

  win.webContents.on("will-navigate", handleNavigation);
  win.webContents.on("will-redirect", handleNavigation);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    const url = parseUrl(target);
    if (!url || !isInternal(url)) {
      openExternal(url);
    }
    // Windows are created explicitly through the manager, including internal ones.
    return { action: "deny" };
  });
};

const parseUrl = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};
