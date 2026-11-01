import { watchIpcFrame } from "./frameLifecycle.ts";
import { bounded, type IpcRequestOptions } from "./request.ts";
/** Structural interfaces: pass Electron's ipcMain / ipcRenderer directly. */
export interface IpcSender {
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
  on(event: "did-frame-navigate", listener: IpcNavigationListener): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "did-frame-navigate", listener: IpcNavigationListener): unknown;
}
export type IpcNavigationListener = (
  event: unknown,
  url: string,
  httpResponseCode: number,
  httpStatusText: string,
  isMainFrame: boolean,
  frameProcessId: number,
  frameRoutingId: number,
) => void;
export interface IpcFrame {
  readonly url: string;
  readonly parent: IpcFrame | null;
  readonly processId: number;
  readonly routingId: number;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}
export interface IpcRequestEvent {
  readonly sender: IpcSender;
  readonly senderFrame: IpcFrame | null;
}
export interface IpcMainTransport {
  handle(channel: string, listener: (event: IpcRequestEvent, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}
export interface IpcRendererTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown;
}
export type Cleanup = () => void;
/** Authorize the calling frame, not just the WebContents containing it. */
export type Authorize = (event: IpcRequestEvent, action: string) => boolean | Promise<boolean>;
export type ServerOptions = {
  authorize: Authorize;
  includeErrorStack?: boolean;
  timeoutMs?: number;
};

export const getChannel = (kind: string, channel: string, action?: string): string =>
  `ipc:${JSON.stringify(action === undefined ? [kind, channel] : [kind, channel, action])}`;

/** A frame must still be the authorized document after an async policy resolves. */
export async function authorizeRequest(
  authorize: Authorize,
  event: IpcRequestEvent,
  action: string,
  options: IpcRequestOptions = {},
): Promise<IpcFrame> {
  const frame = event.senderFrame;
  if (!frame || frame.isDestroyed() || event.sender.isDestroyed())
    throw new Error("IPC sender unavailable");
  const url = frame.url;
  let invalidated = false;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
  signal.throwIfAborted();
  const stop = watchIpcFrame(event.sender, frame, () => {
    invalidated = true;
    controller.abort(new Error("IPC sender changed during authorization"));
  });
  try {
    if (!(await bounded(Promise.resolve(authorize(event, action)), { ...options, signal })))
      throw new Error("IPC access denied");
    if (
      invalidated ||
      event.senderFrame !== frame ||
      frame.isDestroyed() ||
      event.sender.isDestroyed() ||
      frame.url !== url
    ) {
      throw new Error("IPC sender changed during authorization");
    }
    return frame;
  } finally {
    stop();
  }
}
