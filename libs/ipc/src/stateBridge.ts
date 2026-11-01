import { assertIpcData, type IpcData } from "./data.ts";
import { bounded, requestId, timeoutMs } from "./request.ts";
import { readResponse } from "./response.ts";
import type { IpcStateSnapshot } from "./state.ts";
import { getChannel, type Cleanup, type IpcRendererTransport } from "./transport.ts";

export type IpcConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "disposed";
export interface IpcStateBridge<Data extends IpcData> {
  ready(): Promise<Data>;
  reconnect(): Promise<Data>;
  getState(): Data;
  getStatus(): IpcConnectionStatus;
  subscribeStatus(update: (status: IpcConnectionStatus) => void): Cleanup;
  subscribe(update: (data: Data) => void, onError: (error: unknown) => void): Cleanup;
  dispose(): Promise<void>;
}
function readSnapshot<Data extends IpcData>(value: unknown): IpcStateSnapshot<Data> {
  assertIpcData(value);
  if (
    !value ||
    typeof value !== "object" ||
    !("revision" in value) ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.revision !== "number" ||
    value.revision < 0 ||
    !Object.hasOwn(value, "data")
  )
    throw new Error("Invalid IPC state snapshot");
  // Envelope checked above; the main schema establishes the data type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as IpcStateSnapshot<Data>;
}
function safely(callback: () => void) {
  try {
    callback();
  } catch {
    /* Isolate consumer callbacks. */
  }
}
export function createIpcStateBridge<Data extends IpcData>(
  ipcRenderer: IpcRendererTransport,
  channel: string,
  options: { timeoutMs?: number; heartbeatMs?: number } = {},
): IpcStateBridge<Data> {
  timeoutMs(options.timeoutMs);
  const heartbeatMs = timeoutMs(options.heartbeatMs ?? 5_000);
  const updateChannel = getChannel("state", channel);
  const statusChannel = getChannel("state-status", channel);
  const subscribers = new Set<{
    update: (data: Data) => void;
    onError: (error: unknown) => void;
  }>();
  const statusSubscribers = new Set<(status: IpcConnectionStatus) => void>();
  let status: IpcConnectionStatus = "idle";
  let current: IpcStateSnapshot<Data> | undefined;
  let initialization: Promise<Data> | undefined;
  let controller: AbortController | undefined;
  let token: string | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let disposal: Promise<void> | undefined;
  const setStatus = (next: IpcConnectionStatus) => {
    status = next;
    // Snapshot listeners: callbacks may add listeners during delivery.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const callback of [...statusSubscribers]) safely(() => callback(next));
  };
  const release = (id: string) => {
    void ipcRenderer.invoke(getChannel("state-unsubscribe", channel), id).catch(() => {});
  };
  const disconnect = (error: unknown) => {
    if (status === "disposed" || status === "disconnected") return;
    clearTimeout(heartbeat);
    controller?.abort(error);
    if (token) release(token);
    token = undefined;
    initialization = undefined;
    current = undefined;
    setStatus("disconnected");
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const subscriber of [...subscribers]) safely(() => subscriber.onError(error));
  };
  const accept = (value: unknown) => {
    const next = readSnapshot<Data>(value);
    if (current && next.revision <= current.revision) return;
    current = structuredClone(next);
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const subscriber of [...subscribers]) {
      if (!subscribers.has(subscriber)) continue;
      try {
        subscriber.update(structuredClone(next.data));
      } catch (error) {
        safely(() => subscriber.onError(error));
      }
    }
  };
  const listener = (_event: unknown, value: unknown) => {
    if (
      !token ||
      !value ||
      typeof value !== "object" ||
      !("token" in value) ||
      value.token !== token
    )
      return;
    try {
      accept(value);
    } catch (error) {
      for (const sub of subscribers) safely(() => sub.onError(error));
    }
  };
  const statusListener = (_event: unknown, value: unknown) => {
    if (token && value && typeof value === "object" && "token" in value && value.token === token)
      disconnect(new Error("IPC subscription disconnected"));
  };
  ipcRenderer.on(updateChannel, listener);
  ipcRenderer.on(statusChannel, statusListener);
  const scheduleHeartbeat = (id: string) => {
    heartbeat = setTimeout(async () => {
      try {
        readResponse(
          await bounded(ipcRenderer.invoke(getChannel("state-ping", channel), id), options),
        );
        if (token === id) scheduleHeartbeat(id);
      } catch (error) {
        if (token === id) disconnect(error);
      }
    }, heartbeatMs);
    // Node preloads can unref; browser-compatible transports need not provide it.
    heartbeat.unref?.();
  };
  const ready = (): Promise<Data> => {
    if (status === "disposed") return Promise.reject(new Error("IPC state bridge disposed"));
    if (initialization) return initialization;
    const id = requestId();
    token = id;
    current = undefined;
    const attempt = new AbortController();
    controller = attempt;
    setStatus("connecting");
    initialization = Promise.resolve()
      .then(async () => {
        attempt.signal.throwIfAborted();
        const work = ipcRenderer.invoke(getChannel("state-subscribe", channel), id);
        // Release even if a delayed transport delivers registration after cancellation.
        void work.then(
          () => {
            if (token !== id) release(id);
          },
          () => {},
        );
        const response = await bounded(work, { ...options, signal: attempt.signal });
        attempt.signal.throwIfAborted();
        accept(readResponse(response));
        attempt.signal.throwIfAborted();
        setStatus("connected");
        if (token === id) scheduleHeartbeat(id);
        return structuredClone(current!.data);
      })
      .catch((error: unknown) => {
        if (token === id) disconnect(error);
        throw error;
      });
    return initialization;
  };
  return {
    ready,
    reconnect() {
      if (status === "disposed") return ready();
      disconnect(new Error("IPC subscription reconnecting"));
      return ready();
    },
    getStatus: () => status,
    subscribeStatus(callback) {
      if (status === "disposed") throw new Error("IPC state bridge disposed");
      statusSubscribers.add(callback);
      safely(() => callback(status));
      return () => {
        statusSubscribers.delete(callback);
      };
    },
    getState() {
      if (status !== "connected" || !current)
        throw new Error(`IPC state bridge is not ready (${status})`);
      return structuredClone(current.data);
    },
    subscribe(update, onError) {
      if (status === "disposed") throw new Error("IPC state bridge disposed");
      const subscriber = { update, onError };
      subscribers.add(subscriber);
      if (status === "connected" && current) {
        try {
          update(structuredClone(current.data));
        } catch (error) {
          safely(() => onError(error));
        }
      }
      void ready().catch(() => {});
      return () => {
        subscribers.delete(subscriber);
      };
    },
    dispose() {
      if (disposal) return disposal;
      controller?.abort(new Error("IPC state bridge disposed"));
      clearTimeout(heartbeat);
      const id = token;
      token = undefined;
      current = undefined;
      ipcRenderer.removeListener(updateChannel, listener);
      ipcRenderer.removeListener(statusChannel, statusListener);
      setStatus("disposed");
      subscribers.clear();
      statusSubscribers.clear();
      if (id) release(id);
      disposal = Promise.resolve();
      return disposal;
    },
  };
}
