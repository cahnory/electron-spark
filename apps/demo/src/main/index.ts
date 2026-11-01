import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, dialog } from "electron";

import { IS_MAC_OS, MODE } from "./constants.ts";
import { createRenderer } from "./core/windowManager.ts";
import data from "./renderers.generated.ts";
import { createSettings } from "./settings.ts";

const renderers = createRenderer(data);

const mainWindow = renderers.create("view");

const configurePlatformFeatures = (): void => {
  if (os.release().startsWith("6.1")) {
    app.disableHardwareAcceleration();
  }
  if (process.platform === "win32") {
    app.setAppUserModelId(app.getName());
  }
};

const configureUserDataPath = (): void => {
  if (MODE === "test") {
    const testUserDataPath = path.join(app.getPath("userData"), "test");
    app.setPath("userData", testUserDataPath);
    app.on("quit", () => {
      rmSync(testUserDataPath, { force: true, recursive: true });
    });
  }
};

const registerAppLifecycle = (): void => {
  if (!IS_MAC_OS) {
    app.on("window-all-closed", () => {
      app.quit();
    });
  }

  app.on("will-quit", () => {
    // close any listeners or connections
  });
};

const initializeMainProcess = (settings: Awaited<ReturnType<typeof createSettings>>): void => {
  // startUpdater();
  const window = mainWindow.create();
  const documentUrl =
    data.mode === "serve"
      ? new URL(data.renderers.view.url)
      : pathToFileURL(data.renderers.view.path);
  settings.provideTo(window, documentUrl);
  mainWindow.focus();
};

const bootstrap = async (): Promise<void> => {
  if (!app.requestSingleInstanceLock() && MODE !== "test") {
    app.quit();
    return;
  }

  configurePlatformFeatures();
  configureUserDataPath();
  registerAppLifecycle();

  await app.whenReady();
  const settings = await createSettings();
  app.on("activate", () => initializeMainProcess(settings));
  initializeMainProcess(settings);
};

bootstrap().catch((error: unknown) => {
  console.error(error);
  try {
    dialog.showErrorBox(
      "Unable to start",
      `The application could not start.\n\n${error instanceof Error ? error.message : String(error)}\n\n` +
        `If the error concerns settings, check file permissions or restore a valid backup of:\n${path.join(app.getPath("userData"), "settings.json")}\n\n` +
        "To reset settings, move that file aside, then restart the application.",
    );
  } finally {
    app.exit(1);
  }
});
