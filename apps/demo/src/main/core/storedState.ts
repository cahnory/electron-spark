import type { IpcActions, IpcData, IpcValidator } from "@electron-start/ipc";
import {
  createIpcApiServer,
  createIpcState,
  type IpcStateStorage,
  type IpcSender,
  type ServerOptions,
} from "@electron-start/ipc/main";
import { app, ipcMain, type BrowserWindow } from "electron";

type State<Data extends IpcData> = Awaited<ReturnType<typeof createIpcState<Data>>>;

/** Main-owned persisted state and commands, with optional access for any number of windows. */
export const createStoredState = async <Data extends IpcData, Actions extends IpcActions>(options: {
  channel: string;
  storage: IpcStateStorage<Data>;
  schema: IpcValidator<Data>;
  actions: (state: State<Data>) => Actions;
}) => {
  const consumers = new WeakMap<IpcSender, { window: BrowserWindow; url: URL }>();
  const authorize: ServerOptions["authorize"] = ({ sender, senderFrame }) => {
    const consumer = consumers.get(sender);
    if (
      !consumer ||
      consumer.window.isDestroyed() ||
      senderFrame !== consumer.window.webContents.mainFrame
    )
      return false;
    const url = new URL(senderFrame.url);
    const trusted = consumer.url;
    return (
      url.protocol === trusted.protocol &&
      url.host === trusted.host &&
      url.pathname === trusted.pathname &&
      url.username === trusted.username &&
      url.password === trusted.password
    );
  };
  const state = await createIpcState(options.channel, {
    storage: options.storage,
    schema: options.schema,
    authorize,
  });
  const actions = options.actions(state);
  const detachState = state.attach(ipcMain);
  let detachApi: () => void;
  try {
    detachApi = createIpcApiServer(options.channel, actions, { authorize }).attach(ipcMain);
  } catch (error) {
    detachState();
    throw error;
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    app.removeListener("will-quit", dispose);
    detachApi();
    detachState();
  };
  app.once("will-quit", dispose);
  return {
    state,
    actions,
    provideTo(window: BrowserWindow, documentUrl: URL) {
      if (disposed) throw new Error("Stored state service disposed");
      const consumer = { window, url: new URL(documentUrl.href) };
      consumers.set(window.webContents, consumer);
      return () => {
        if (consumers.get(window.webContents) === consumer) consumers.delete(window.webContents);
      };
    },
    dispose,
  };
};
