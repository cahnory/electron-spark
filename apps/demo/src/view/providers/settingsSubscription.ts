import type { Settings } from "../../main/settings.ts";

type SettingsSource = {
  subscribe(update: (state: Settings) => void, onError: (error: unknown) => void): () => void;
  reconnect(): Promise<Settings>;
};

export function subscribeSettings(
  source: SettingsSource,
  update: (state: Settings) => void,
  onError: (error: unknown) => void,
  retryMs = 1000,
) {
  let active = true;
  let retrying = false;
  let delay = retryMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = (error: unknown) => {
    if (!active) return;
    onError(error);
    if (!timer && !retrying) {
      timer = setTimeout(retry, delay);
      delay = Math.min(delay * 2, 30_000);
    }
  };
  const retry = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!active || retrying) return;
    retrying = true;
    void source
      .reconnect()
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
    retry,
    dispose() {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    },
  };
}
