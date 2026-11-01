import { validate, type IpcValidator } from "./action.ts";
import { assertIpcData, type IpcData } from "./data.ts";
import { watchIpcFrame } from "./frameLifecycle.ts";
import { bounded, timeoutMs } from "./request.ts";
import { errorResponse } from "./response.ts";
import {
  authorizeRequest,
  getChannel,
  type IpcFrame,
  type IpcMainTransport,
  type IpcSender,
  type ServerOptions,
} from "./transport.ts";

export type IpcStateSnapshot<Data extends IpcData> = { revision: number; data: Data };

/** Structurally compatible with @electron-start/store storage adapters. */
export type IpcStateStorage<Data extends IpcData> = {
  read: () => unknown;
  write: (data: Data) => void | Promise<void>;
};

/** Main-process state. Validation, persistence, and commits are ordered. */
export async function createIpcState<Data extends IpcData>(
  channel: string,
  options: ServerOptions & {
    schema: IpcValidator<Data>;
    /** Synchronous per-frame projection; never send the backing state by accident. */
    select?: (data: Data, context: { frame: IpcFrame; sender: IpcSender }) => IpcData;
    leaseMs?: number;
  } & (
      | { initialState: Data; storage?: undefined }
      | { storage: IpcStateStorage<Data>; initialState?: undefined }
    ),
) {
  timeoutMs(options.timeoutMs);
  const leaseMs = timeoutMs(options.leaseMs ?? 30_000);
  const prepare = async (data: unknown): Promise<Data> => {
    const result = await bounded(validate(options.schema, data), { timeoutMs: options.timeoutMs });
    assertIpcData(result);
    return structuredClone(result);
  };
  const storage = options.storage;
  // Capture ownership before validation can yield to the caller.
  const initialState = storage ? await storage.read() : options.initialState;
  assertIpcData(initialState);
  let data = await prepare(structuredClone(initialState));
  let revision = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const attachments = new Map<IpcMainTransport, () => void>();
  const publishers = new Set<(snapshot: IpcStateSnapshot<Data>) => void>();
  const snapshot = (): IpcStateSnapshot<Data> => ({ revision, data: structuredClone(data) });
  const project = (
    current: IpcStateSnapshot<Data>,
    owner: { frame: IpcFrame; sender: IpcSender },
  ) => {
    const view = options.select
      ? options.select(structuredClone(current.data), owner)
      : current.data;
    assertIpcData(view);
    return { revision: current.revision, data: structuredClone(view) };
  };
  return {
    channel,
    getState: () => structuredClone(data),
    getSnapshot: snapshot,
    async setState(
      next: Data | ((current: Data) => Data | Promise<Data>),
      expectedRevision?: number,
    ): Promise<void> {
      // Capture ownership now, rather than retaining mutable caller data in the queue.
      if (typeof next !== "function") assertIpcData(next);
      const input = typeof next === "function" ? next : structuredClone(next);
      const commit = queue.then(async () => {
        if (expectedRevision !== undefined && expectedRevision !== revision)
          throw new Error("IPC state revision conflict");
        const prepared = await prepare(
          typeof input === "function"
            ? await bounded(Promise.resolve(input(structuredClone(data))), {
                timeoutMs: options.timeoutMs,
              })
            : input,
        );
        // Await actual completion: timing out a write could let it overwrite a later commit.
        // Give storage its own clone so adapters cannot mutate the committed state.
        if (storage) await storage.write(structuredClone(prepared));
        data = prepared;
        revision += 1;
        for (const publish of publishers) publish(snapshot());
      });
      queue = commit.catch(() => {});
      return commit;
    },
    isAttachedTo: (ipcMain: IpcMainTransport) => attachments.has(ipcMain),
    attach(ipcMain: IpcMainTransport) {
      if (attachments.has(ipcMain)) throw new Error("IPC state already attached");
      let active = true;
      const subscribers = new Map<
        string,
        { frame: IpcFrame; sender: IpcSender; url: string; expires: number; cleanup: () => void }
      >();
      const pending = new Map<
        string,
        { event: import("./transport.ts").IpcRequestEvent; controller: AbortController }
      >();
      const subscribeChannel = getChannel("state-subscribe", channel);
      const unsubscribeChannel = getChannel("state-unsubscribe", channel);
      const updateChannel = getChannel("state", channel);
      const registered: string[] = [];
      const publish = (current: IpcStateSnapshot<Data>) => {
        for (const [token, subscriber] of subscribers) {
          try {
            if (subscriber.frame.isDestroyed() || subscriber.frame.url !== subscriber.url) {
              subscriber.cleanup();
              continue;
            }
            subscriber.frame.send(updateChannel, { token, ...project(current, subscriber) });
          } catch {
            subscriber.cleanup();
          }
        }
      };
      const leaseTimer = setInterval(
        () => {
          for (const subscriber of subscribers.values())
            if (subscriber.expires <= Date.now()) subscriber.cleanup();
        },
        Math.min(leaseMs, 1000),
      );
      leaseTimer.unref();
      try {
        const pingChannel = getChannel("state-ping", channel);
        ipcMain.handle(pingChannel, async (event, token) => {
          const subscriber = typeof token === "string" ? subscribers.get(token) : undefined;
          const isOwner =
            subscriber?.frame === event.senderFrame && subscriber?.sender === event.sender;
          try {
            if (!subscriber || !isOwner) throw new Error("IPC subscription disconnected");
            await authorizeRequest(options.authorize, event, "subscribe", {
              timeoutMs: options.timeoutMs,
            });
            if (!active || subscribers.get(String(token)) !== subscriber)
              throw new Error("IPC subscription disconnected");
            subscriber.expires = Date.now() + leaseMs;
            return { ok: true, data: undefined };
          } catch (error) {
            if (isOwner && subscribers.get(String(token)) === subscriber) subscriber?.cleanup();
            return errorResponse(error, options.includeErrorStack);
          }
        });
        registered.push(pingChannel);
        ipcMain.handle(subscribeChannel, async (event, token) => {
          const controller = new AbortController();
          try {
            if (
              typeof token !== "string" ||
              token.length === 0 ||
              token.length > 128 ||
              pending.has(token) ||
              subscribers.has(token)
            )
              throw new Error("Invalid subscription token");
            pending.set(token, { event, controller });
            const frame = await authorizeRequest(options.authorize, event, "subscribe", {
              timeoutMs: options.timeoutMs,
              signal: controller.signal,
            });
            controller.signal.throwIfAborted();
            if (!active) throw new Error("IPC state disposed");
            if (typeof token !== "string" || token.length === 0 || token.length > 128)
              throw new Error("Invalid subscription token");
            if (subscribers.has(token)) throw new Error("Duplicate subscription token");
            const current = project(snapshot(), { frame, sender: event.sender });
            let stopWatching: () => void;
            const cleanup = () => {
              if (!subscribers.delete(token)) return;
              try {
                frame.send(getChannel("state-status", channel), { token, status: "disconnected" });
              } catch {
                /* Heartbeat detects unreachable peers. */
              }
              stopWatching();
            };
            stopWatching = watchIpcFrame(event.sender, frame, cleanup);
            subscribers.set(token, {
              frame,
              sender: event.sender,
              url: frame.url,
              expires: Date.now() + leaseMs,
              cleanup,
            });
            return { ok: true, data: current };
          } catch (error) {
            return errorResponse(error, options.includeErrorStack);
          } finally {
            if (typeof token === "string" && pending.get(token)?.controller === controller)
              pending.delete(token);
          }
        });
        registered.push(subscribeChannel);
        ipcMain.handle(unsubscribeChannel, (event, token) => {
          try {
            // Owners may always release resources, including after permission is revoked.
            if (typeof token !== "string" || token.length === 0 || token.length > 128)
              throw new Error("Invalid subscription token");
            const registration = pending.get(token);
            if (registration) {
              if (
                registration.event.sender !== event.sender ||
                registration.event.senderFrame !== event.senderFrame
              )
                throw new Error("IPC access denied");
              registration.controller.abort(new Error("IPC subscription cancelled"));
            }
            const subscriber = subscribers.get(token);
            if (
              subscriber &&
              (subscriber.frame !== event.senderFrame || subscriber.sender !== event.sender)
            )
              throw new Error("IPC access denied");
            subscriber?.cleanup();
            return { ok: true, data: undefined };
          } catch (error) {
            return errorResponse(error, options.includeErrorStack);
          }
        });
        registered.push(unsubscribeChannel);
      } catch (error) {
        active = false;
        clearInterval(leaseTimer);
        for (const entry of pending.values())
          entry.controller.abort(new Error("IPC state disposed"));
        for (const name of registered) ipcMain.removeHandler(name);
        throw error;
      }
      publishers.add(publish);
      const dispose = () => {
        if (!active) return;
        active = false;
        clearInterval(leaseTimer);
        for (const entry of pending.values())
          entry.controller.abort(new Error("IPC state disposed"));
        publishers.delete(publish);
        for (const subscriber of subscribers.values()) subscriber.cleanup();
        for (const name of registered) ipcMain.removeHandler(name);
        attachments.delete(ipcMain);
      };
      attachments.set(ipcMain, dispose);
      return dispose;
    },
  };
}
