import { validate, type IpcValidator } from "./action.ts";
import { assertIpcData, type IpcData } from "./data.ts";
import { bounded, timeoutMs } from "./request.ts";
import { getChannel, type IpcRendererTransport } from "./transport.ts";

/** Transient messages have no replay. Keep persistent information in state. */
export function createIpcEventBridge<Data extends IpcData>(
  ipcRenderer: IpcRendererTransport,
  channel: string,
  schema: IpcValidator<Data>,
  options: { timeoutMs?: number } = {},
) {
  timeoutMs(options.timeoutMs);
  return {
    subscribe(callback: (data: Data) => void, onError: (error: unknown) => void) {
      let active = true;
      const listener = (_event: unknown, value: unknown) => {
        const deliver = async () => {
          assertIpcData(value);
          const data = await bounded(validate(schema, value), options);
          assertIpcData(data);
          if (active) callback(data);
        };
        void deliver().catch((error) => {
          if (active) {
            try {
              onError(error);
            } catch {
              /* Isolate callbacks. */
            }
          }
        });
      };
      const eventChannel = getChannel("event", channel);
      ipcRenderer.on(eventChannel, listener);
      return () => {
        active = false;
        ipcRenderer.removeListener(eventChannel, listener);
      };
    },
  };
}
