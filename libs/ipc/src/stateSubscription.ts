import type { IpcData } from "./data.ts";
import type { IpcStateBridge } from "./stateBridge.ts";

/** Subscribe with exponential reconnect retries. Disposal leaves the shared bridge alive. */
export function subscribeIpcState<const T extends IpcData>({
  source,
  update,
  onError,
  retryMs = 1000,
}: {
  source: IpcStateBridge<T>;
  update: (state: T) => void;
  onError?: (error: unknown) => void;
  retryMs?: number;
}) {
  let active = true;
  let retrying = false;
  let delay = retryMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = (error: unknown) => {
    if (!active) return;
    try {
      onError?.(error);
    } catch {
      /* Error reporting must not prevent recovery. */
    }
    if (!timer && !retrying) {
      timer = setTimeout(() => connect(false), delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  const connect = (force: boolean) => {
    clearTimeout(timer);
    timer = undefined;
    if (!active || retrying) return;
    retrying = true;
    // Automatic retries join initialization shared by other subscribers.
    const pending = force ? source.reconnect() : source.ready();
    void pending
      .catch((error: unknown) => {
        retrying = false;
        failed(error);
      })
      .finally(() => {
        retrying = false;
      });
  };
  const unsubscribe = source.subscribe((state) => {
    if (!active) return;
    clearTimeout(timer);
    timer = undefined;
    delay = retryMs;
    update(state);
  }, failed);
  return {
    retry: () => connect(true),
    dispose() {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    },
  };
}
