import type { IpcActions } from "./action.ts";
import { bounded, timeoutMs, type IpcRequestOptions } from "./request.ts";
import { errorResponse } from "./response.ts";
import { getChannel, type IpcRendererTransport } from "./transport.ts";

/** Install only explicitly supplied, validated renderer handlers. Never expose ipcRenderer. */
export function createIpcRendererBridge(
  ipcRenderer: IpcRendererTransport,
  channel: string,
  actions: IpcActions,
  options: IpcRequestOptions = {},
) {
  timeoutMs(options.timeoutMs);
  let active = true;
  const controller = new AbortController();
  const callChannel = getChannel("renderer-call", channel);
  const listener = (_event: unknown, value: unknown) => {
    if (
      !active ||
      !value ||
      typeof value !== "object" ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      !("action" in value) ||
      typeof value.action !== "string" ||
      !("args" in value) ||
      !Array.isArray(value.args)
    )
      return;
    const { id, action, args } = value;
    const execute = async () => {
      const requestController = new AbortController();
      try {
        if (!Object.hasOwn(actions, action)) throw new Error("Unknown IPC renderer action");
        const signal = AbortSignal.any([
          controller.signal,
          requestController.signal,
          ...(options.signal ? [options.signal] : []),
        ]);
        const data = await bounded(
          actions[action].invoke(args, () => signal.throwIfAborted()),
          { ...options, signal },
        );
        return { ok: true, data };
      } catch (error) {
        return errorResponse(error);
      } finally {
        requestController.abort(new Error("IPC renderer request finished"));
      }
    };
    void execute()
      .then((response) => ipcRenderer.invoke(getChannel("renderer-reply", channel), id, response))
      .catch(() => {});
  };
  ipcRenderer.on(callChannel, listener);
  return () => {
    if (!active) return;
    active = false;
    controller.abort(new Error("IPC renderer bridge disposed"));
    ipcRenderer.removeListener(callChannel, listener);
  };
}
