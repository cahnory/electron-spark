import path from "node:path";

import { createFileSystemAdaptor, createVersionedStorage } from "@electron-spark/store";
import { app } from "electron";

export const createSettingsRepository = () =>
  createVersionedStorage({
    version: 1,
    storage: createFileSystemAdaptor<unknown>(path.join(app.getPath("userData"), "settings.json"), {
      version: 1,
      data: { locale: "en" },
    }),
  });
