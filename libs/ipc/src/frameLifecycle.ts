import type { Cleanup, IpcFrame, IpcNavigationListener, IpcSender } from "./transport.ts";

// URL changes alone do not identify a new document (hash routing and history APIs).
// Committed cross-document navigation is handled by did-frame-navigate below.
type Watcher = { frame: IpcFrame; invalidate: Cleanup };
type Owner = { watchers: Set<Watcher>; stop: Cleanup };
const owners = new WeakMap<IpcSender, Owner>();

function isExpired(sender: IpcSender, watcher: Watcher): boolean {
  try {
    return sender.isDestroyed() || watcher.frame.isDestroyed();
  } catch {
    return true;
  }
}
function isWithin(frame: IpcFrame, processId: number, routingId: number): boolean {
  try {
    for (let current: IpcFrame | null = frame; current; current = current.parent) {
      if (
        current.isDestroyed() ||
        (current.processId === processId && current.routingId === routingId)
      )
        return true;
    }
    return false;
  } catch {
    // An inaccessible ancestor means this subscription can no longer be trusted.
    return true;
  }
}

/** Share lifecycle listeners and one idle-frame sweep across all state services. */
export function watchIpcFrame(sender: IpcSender, frame: IpcFrame, onInvalidated: Cleanup): Cleanup {
  if (sender.isDestroyed() || frame.isDestroyed()) throw new Error("IPC sender unavailable");
  let owner = owners.get(sender);
  if (!owner) {
    const watchers = new Set<Watcher>();
    const destroyed = () => {
      for (const watcher of watchers) watcher.invalidate();
    };
    const navigation: IpcNavigationListener = (
      _event,
      _url,
      _status,
      _text,
      isMainFrame,
      processId,
      routingId,
    ) => {
      for (const watcher of watchers) {
        if (
          isMainFrame ||
          isExpired(sender, watcher) ||
          isWithin(watcher.frame, processId, routingId)
        ) {
          watcher.invalidate();
        }
      }
    };
    // Electron has no public frame-destroyed event. Bound retention of removed
    // iframes even when state never changes and their WebContents stays alive.
    const timer = setInterval(() => {
      for (const watcher of watchers) {
        if (isExpired(sender, watcher)) watcher.invalidate();
      }
    }, 1000);
    timer.unref();
    sender.once("destroyed", destroyed);
    sender.on("did-frame-navigate", navigation);
    owner = {
      watchers,
      stop: () => {
        clearInterval(timer);
        sender.removeListener("destroyed", destroyed);
        sender.removeListener("did-frame-navigate", navigation);
        owners.delete(sender);
      },
    };
    owners.set(sender, owner);
  }
  const group = owner;
  const unwatch = () => {
    if (!group.watchers.delete(watcher)) return;
    if (group.watchers.size === 0) group.stop();
  };
  const watcher: Watcher = {
    frame,
    invalidate: () => {
      unwatch();
      onInvalidated();
    },
  };
  group.watchers.add(watcher);
  return unwatch;
}
