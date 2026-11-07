import { createIpcApiBridge, createIpcStateBridge } from "@electron-spark/ipc/renderer";
import { ipcRenderer } from "electron";

import type { Settings } from "../main/features/settings/settings.dto.ts";
import type { SettingsActions } from "../main/features/settings/settings.ipc.ts";

export const settings = {
  state: createIpcStateBridge<Settings>(ipcRenderer, "settings"),
  api: createIpcApiBridge<SettingsActions>(ipcRenderer, "settings", {
    setLocale: true,
  }),
};

export { type Settings };

window.addEventListener("unload", () => {
  void settings.state.dispose();
});
