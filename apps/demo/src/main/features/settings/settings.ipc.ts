import { defineIpcAction } from "@electron-spark/ipc/main";
import { z } from "zod";

import { createStoredState } from "../../core/storedState.ts";
import { localeSchema, settingsSchema } from "./settings.dto.ts";
import { createSettingsRepository } from "./settings.repository.ts";

export const createSettings = () => {
  return createStoredState({
    channel: "settings",
    storage: createSettingsRepository(),
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
