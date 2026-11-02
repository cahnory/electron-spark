import type { IpcActions, IpcData, IpcValidator } from "@electron-spark/ipc";
import {
  createIpcAccessPolicy,
  createIpcService,
  type IpcState,
  type IpcStateStorage,
} from "@electron-spark/ipc/main";
import { app, ipcMain, type BrowserWindow } from "electron";

/** Main-owned persisted state and commands, with optional access for any number of windows. */
export const createStoredState = async <Data extends IpcData, Actions extends IpcActions>(options: {
  channel: string;
  storage: IpcStateStorage<Data>;
  schema: IpcValidator<Data>;
  actions: (state: IpcState<Data>) => Actions;
}) => {
  // Routing may change search parameters and fragments within this document.
  const access = createIpcAccessPolicy({ ignoreSearch: true, ignoreHash: true });
  const service = await createIpcService(options.channel, {
    ...options,
    authorize: access.authorize,
  });
  const detach = service.attach(ipcMain);
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    app.removeListener("will-quit", dispose);
    detach();
  };
  app.once("will-quit", dispose);
  return {
    state: service.state,
    actions: service.actions,
    provideTo(window: BrowserWindow, documentUrl: URL) {
      if (disposed) throw new Error("Stored state service disposed");
      return access.grant(window.webContents, documentUrl);
    },
    dispose,
  };
};
