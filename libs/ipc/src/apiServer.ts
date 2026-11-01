import type { IpcActions } from "./action.ts";
import { requestContext } from "./context.ts";
import { watchIpcFrame } from "./frameLifecycle.ts";
import { bounded, timeoutMs } from "./request.ts";
import { errorResponse } from "./response.ts";
import type { IpcRequestEvent } from "./transport.ts";
import {
  authorizeRequest,
  getChannel,
  type IpcMainTransport,
  type ServerOptions,
} from "./transport.ts";

export function createIpcApiServer<const Actions extends IpcActions>(
  channel: string,
  actions: Actions,
  options: ServerOptions,
) {
  timeoutMs(options.timeoutMs);
  const attached = new Set<IpcMainTransport>();
  return {
    channel,
    actions,
    isAttachedTo: (ipcMain: IpcMainTransport) => attached.has(ipcMain),
    attach(ipcMain: IpcMainTransport) {
      if (attached.has(ipcMain)) throw new Error("IPC API server already attached");
      const registered: string[] = [];
      let active = true;
      const pending = new Map<string, { event: IpcRequestEvent; controller: AbortController }>();
      try {
        const cancelChannel = getChannel("cancel", channel);
        ipcMain.handle(cancelChannel, (event, id) => {
          const request = typeof id === "string" ? pending.get(id) : undefined;
          if (
            request &&
            request.event.sender === event.sender &&
            request.event.senderFrame === event.senderFrame
          )
            request.controller.abort(new Error("IPC request cancelled"));
          return { ok: true, data: undefined };
        });
        registered.push(cancelChannel);
        for (const [name, action] of Object.entries(actions)) {
          if (name === "then") throw new Error('IPC action name "then" is reserved');
          const callChannel = getChannel("call", channel, name);
          ipcMain.handle(callChannel, async (event, envelope) => {
            const controller = new AbortController();
            let id: string | undefined;
            let stop: (() => void) | undefined;
            try {
              if (
                !envelope ||
                typeof envelope !== "object" ||
                !("id" in envelope) ||
                typeof envelope.id !== "string" ||
                envelope.id.length > 128 ||
                !envelope.id ||
                !("args" in envelope) ||
                !Array.isArray(envelope.args) ||
                pending.has(envelope.id)
              )
                throw new Error("Invalid IPC request");
              id = envelope.id;
              pending.set(id, { event, controller });
              const frame = event.senderFrame;
              if (!frame) throw new Error("IPC sender unavailable");
              stop = watchIpcFrame(event.sender, frame, () =>
                controller.abort(new Error("IPC sender changed during authorization or execution")),
              );
              const args = envelope.args;
              const work = async () => {
                await authorizeRequest(options.authorize, event, name, {
                  timeoutMs: options.timeoutMs,
                  signal: controller.signal,
                });
                controller.signal.throwIfAborted();
                if (!active) throw new Error("IPC API server disposed");
                return requestContext.run(
                  Object.freeze({
                    sender: event.sender,
                    frame,
                    channel,
                    action: name,
                    requestId: id!,
                    signal: controller.signal,
                  }),
                  () => action.invoke(args, () => controller.signal.throwIfAborted()),
                );
              };
              const data = await bounded(work(), {
                timeoutMs: timeoutMs(options.timeoutMs),
                signal: controller.signal,
              });
              return { ok: true, data };
            } catch (error) {
              return errorResponse(error, options.includeErrorStack);
            } finally {
              controller.abort(new Error("IPC request finished"));
              stop?.();
              if (id) pending.delete(id);
            }
          });
          registered.push(callChannel);
        }
      } catch (error) {
        active = false;
        for (const request of pending.values())
          request.controller.abort(new Error("IPC API server disposed"));
        for (const name of registered) ipcMain.removeHandler(name);
        throw error;
      }
      attached.add(ipcMain);
      return () => {
        if (!active) return;
        active = false;
        for (const request of pending.values())
          request.controller.abort(new Error("IPC API server disposed"));
        for (const name of registered) ipcMain.removeHandler(name);
        attached.delete(ipcMain);
      };
    },
  };
}
