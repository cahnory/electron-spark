import {
  validate,
  type IpcAction,
  type IpcActions,
  type IpcApiClient,
  type IpcValidator,
} from "./action.ts";
import { assertIpcData, type IpcData } from "./data.ts";
import { watchIpcFrame } from "./frameLifecycle.ts";
import { bounded, requestId, timeoutMs, type IpcRequestOptions } from "./request.ts";
import { readResponse } from "./response.ts";
import {
  authorizeRequest,
  getChannel,
  type IpcMainTransport,
  type IpcRequestEvent,
  type ServerOptions,
} from "./transport.ts";

/** Main-owned request/reply routing. Responses must come from the exact target frame. */
export function createIpcRendererServer<Actions extends IpcActions>(
  channel: string,
  actions: { readonly [Key in keyof Actions]: true },
  options: ServerOptions & {
    results: {
      readonly [Key in keyof Actions]: Actions[Key] extends IpcAction<infer _Params, infer Result>
        ? IpcValidator<Result>
        : never;
    };
  },
) {
  timeoutMs(options.timeoutMs);
  const pending = new Map<string, { target: IpcRequestEvent; resolve: (value: unknown) => void }>();
  let attached = false;
  let lifetime = new AbortController();
  return {
    attach(ipcMain: IpcMainTransport) {
      if (attached) throw new Error("IPC renderer server already attached");
      const replyChannel = getChannel("renderer-reply", channel);
      ipcMain.handle(replyChannel, (event, id, response) => {
        const call = typeof id === "string" ? pending.get(id) : undefined;
        if (
          !call ||
          call.target.sender !== event.sender ||
          call.target.senderFrame !== event.senderFrame
        )
          return { ok: false, error: { name: "Error", message: "IPC access denied" } };
        pending.delete(String(id));
        call.resolve(response);
        return { ok: true, data: undefined };
      });
      attached = true;
      lifetime = new AbortController();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        attached = false;
        lifetime.abort(new Error("IPC renderer server disposed"));
        ipcMain.removeHandler(replyChannel);
      };
    },
    client(target: IpcRequestEvent, requestOptions: IpcRequestOptions = {}): IpcApiClient<Actions> {
      timeoutMs(requestOptions.timeoutMs);
      // Constructed exclusively from the explicit action allowlist.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const methods = Object.create(null) as Record<
        string,
        (...args: IpcData[]) => Promise<IpcData>
      >;
      // Capture the document reference, not the caller's mutable event wrapper.
      const owner = { sender: target.sender, senderFrame: target.senderFrame };
      for (const name of Object.keys(actions)) {
        if (name === "then") throw new Error('IPC action name "then" is reserved');
        methods[name] = async (...args) => {
          assertIpcData(args);
          if (!attached || !owner.senderFrame) throw new Error("IPC renderer server unavailable");
          const controller = new AbortController();
          const signal = AbortSignal.any([
            controller.signal,
            lifetime.signal,
            ...(requestOptions.signal ? [requestOptions.signal] : []),
          ]);
          signal.throwIfAborted();
          const stop = watchIpcFrame(owner.sender, owner.senderFrame, () =>
            controller.abort(new Error("IPC target navigated")),
          );
          const id = requestId();
          try {
            const work = async () => {
              const frame = await authorizeRequest(options.authorize, owner, name, {
                timeoutMs: options.timeoutMs,
                signal,
              });
              signal.throwIfAborted();
              return new Promise<unknown>((resolve, reject) => {
                pending.set(id, { target: owner, resolve });
                try {
                  frame.send(getChannel("renderer-call", channel), { id, action: name, args });
                } catch (error) {
                  reject(error);
                }
              });
            };
            return await bounded(
              (async () => {
                const response = readResponse(await work());
                signal.throwIfAborted();
                const validated = await validate(options.results[name], response);
                signal.throwIfAborted();
                assertIpcData(validated);
                return validated;
              })(),
              { timeoutMs: requestOptions.timeoutMs ?? options.timeoutMs, signal },
            );
          } finally {
            controller.abort(new Error("IPC renderer request finished"));
            pending.delete(id);
            stop();
          }
        };
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return Object.freeze(methods) as IpcApiClient<Actions>;
    },
  };
}
