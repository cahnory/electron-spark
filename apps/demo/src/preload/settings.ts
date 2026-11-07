import { createIpcApiBridge, createIpcStateBridge } from "@electron-spark/ipc/renderer";
import { ipcRenderer } from "electron";

import type { Settings, SettingsActions } from "../main/settings.ts";

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
