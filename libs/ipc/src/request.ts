export type IpcRequestOptions = {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
};
export const requestId = () => globalThis.crypto.randomUUID();
export function timeoutMs(value = 30_000): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647)
    throw new Error("IPC timeout must be a positive finite timer duration");
  return value;
}
export function bounded<T>(work: Promise<T>, options: IpcRequestOptions = {}): Promise<T> {
  const duration = timeoutMs(options.timeoutMs);
  return new Promise((resolve, reject) => {
    const abort = () =>
      finish(() => reject(options.signal?.reason ?? new Error("IPC request aborted")));
    const timer = setTimeout(
      () => finish(() => reject(new Error("IPC request timed out"))),
      duration,
    );
    const finish = (done: () => void) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      done();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    work.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
