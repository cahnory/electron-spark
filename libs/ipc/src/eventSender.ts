import { validate, type IpcValidator } from "./action.ts";
import { assertIpcData, type IpcData } from "./data.ts";
import { watchIpcFrame } from "./frameLifecycle.ts";
import { bounded, timeoutMs } from "./request.ts";
import {
  authorizeRequest,
  getChannel,
  type IpcRequestEvent,
  type ServerOptions,
} from "./transport.ts";
export function createIpcEventSender<Data extends IpcData>(
  channel: string,
  schema: IpcValidator<Data>,
  options: ServerOptions,
) {
  timeoutMs(options.timeoutMs);
  return {
    async send(target: IpcRequestEvent, value: Data): Promise<void> {
      assertIpcData(value);
      const input = structuredClone(value);
      const owner = { sender: target.sender, senderFrame: target.senderFrame };
      if (!owner.senderFrame) throw new Error("IPC target unavailable");
      const controller = new AbortController();
      const stop = watchIpcFrame(owner.sender, owner.senderFrame, () =>
        controller.abort(new Error("IPC target navigated")),
      );
      try {
        await bounded(
          (async () => {
            const frame = await authorizeRequest(options.authorize, owner, "event", {
              timeoutMs: options.timeoutMs,
              signal: controller.signal,
            });
            const data = await validate(schema, input);
            controller.signal.throwIfAborted();
            assertIpcData(data);
            frame.send(getChannel("event", channel), data);
          })(),
          { timeoutMs: options.timeoutMs, signal: controller.signal },
        );
      } finally {
        controller.abort();
        stop();
      }
    },
  };
}
