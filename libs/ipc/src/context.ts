import { AsyncLocalStorage } from "node:async_hooks";

import type { IpcFrame, IpcSender } from "./transport.ts";
export type IpcContext = Readonly<{
  sender: IpcSender;
  frame: IpcFrame;
  channel: string;
  action: string;
  requestId: string;
  signal: AbortSignal;
}>;
export const requestContext = new AsyncLocalStorage<IpcContext>();
/** Main only. Valid across awaits; unavailable outside an active handler. */
export function getIpcContext(): IpcContext {
  const context = requestContext.getStore();
  if (!context) throw new Error("No active IPC request context");
  context.signal.throwIfAborted();
  return context;
}
