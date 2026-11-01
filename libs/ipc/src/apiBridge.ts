import type { IpcActions, IpcApiClient } from "./action.ts";
import { assertIpcData, type IpcData } from "./data.ts";
import { bounded, requestId, timeoutMs, type IpcRequestOptions } from "./request.ts";
import { readResponse } from "./response.ts";
import { getChannel, type IpcRendererTransport } from "./transport.ts";

/** Expose this object through contextBridge. Its allowlist is enforced at runtime. */
export function createIpcApiBridge<Actions extends IpcActions>(
  ipcRenderer: IpcRendererTransport,
  channel: string,
  actions: { readonly [Key in keyof Actions]: true },
  options: IpcRequestOptions = {},
): IpcApiClient<Actions> {
  timeoutMs(options.timeoutMs);
  // A null prototype prevents inherited properties from becoming API methods.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const client = Object.create(null) as Record<
    string,
    (...args: readonly IpcData[]) => Promise<IpcData>
  >;
  for (const action of Object.keys(actions)) {
    if (action === "then") throw new Error('IPC action name "then" is reserved');
    Object.defineProperty(client, action, {
      enumerable: true,
      value: async (...args: readonly IpcData[]) => {
        assertIpcData(args);
        options.signal?.throwIfAborted();
        const id = requestId();
        try {
          return readResponse(
            await bounded(
              ipcRenderer.invoke(getChannel("call", channel, action), { id, args }),
              options,
            ),
          );
        } catch (error) {
          void ipcRenderer.invoke(getChannel("cancel", channel), id).catch(() => {});
          throw error;
        }
      },
    });
  }
  // The exhaustive allowlist constructs the mapped methods; main validates their data.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return Object.freeze(client) as IpcApiClient<Actions>;
}

/** Renderer facade: the preload bridge already contains explicit methods. */
export function createIpcApiClient<Client extends object>(bridge: Client): Client {
  return bridge;
}
