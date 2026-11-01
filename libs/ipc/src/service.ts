import type { IpcActions } from "./action.ts";
import { createIpcApiServer } from "./apiServer.ts";
import type { IpcData } from "./data.ts";
import { createIpcState } from "./state.ts";
import type { IpcMainTransport } from "./transport.ts";

export type IpcState<Data extends IpcData> = Awaited<ReturnType<typeof createIpcState<Data>>>;
export type IpcServiceOptions<Data extends IpcData, Actions extends IpcActions> = Parameters<
  typeof createIpcState<Data>
>[1] & {
  actions: (state: IpcState<Data>) => Actions;
};

/** Optional composition of main-owned state and commands with shared authorization. */
export async function createIpcService<Data extends IpcData, const Actions extends IpcActions>(
  channel: string,
  options: IpcServiceOptions<Data, Actions>,
) {
  const state = await createIpcState<Data>(channel, options);
  const actions = options.actions(state);
  const api = createIpcApiServer(channel, actions, options);
  return {
    channel,
    state,
    actions,
    attach(ipcMain: IpcMainTransport) {
      const detachState = state.attach(ipcMain);
      let detachApi: () => void;
      try {
        detachApi = api.attach(ipcMain);
      } catch (error) {
        detachState();
        throw error;
      }
      return () => {
        detachApi();
        detachState();
      };
    },
  };
}
