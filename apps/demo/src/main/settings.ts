import path from "node:path";

import { defineIpcAction } from "@electron-start/ipc/main";
import { createFileSystemAdaptor, createVersionedStorage } from "@electron-start/store";
import { app } from "electron";
import { z } from "zod";

import { createStoredState } from "./core/storedState.ts";

const localeSchema = z.enum(["fr", "en"]);
const settingsSchema = z.object({ locale: localeSchema });
export type Settings = z.infer<typeof settingsSchema>;

export const createSettings = () => {
  const file = createFileSystemAdaptor<unknown>(
    path.join(app.getPath("userData"), "settings.json"),
    { version: 1, data: { locale: "en" } },
  );
  return createStoredState({
    channel: "settings",
    storage: createVersionedStorage({
      version: 1,
      validator: settingsSchema,
      storage: file,
    }),
    schema: settingsSchema,
    actions: (state) => ({
      setLocale: defineIpcAction({
        params: z.tuple([localeSchema]),
        handler: (locale) => state.setState((current) => ({ ...current, locale })),
      }),
    }),
  });
};

export type SettingsActions = Awaited<ReturnType<typeof createSettings>>["actions"];
