import type { Authorize, Cleanup, IpcFrame, IpcSender } from "./transport.ts";

/** Explicit grants for a sender's current main frame and trusted document. */
export function createIpcAccessPolicy(
  options: { ignoreSearch?: boolean; ignoreHash?: boolean } = {},
) {
  type Sender = IpcSender & { readonly mainFrame: IpcFrame };
  const grants = new WeakMap<IpcSender, { url: URL; sender: Sender }>();
  const listeners = new Set<(sender: IpcSender) => void>();
  const notify = (sender: IpcSender) => {
    for (const listener of listeners) listener(sender);
  };
  const authorize: Authorize = Object.assign(
    ({ sender, senderFrame }: Parameters<Authorize>[0]) => {
      const grant = grants.get(sender);
      if (!grant || sender.isDestroyed() || senderFrame !== grant.sender.mainFrame) return false;
      try {
        if (!senderFrame || senderFrame.isDestroyed()) return false;
        const url = new URL(senderFrame.url);
        const trusted = grant.url;
        return (
          url.protocol === trusted.protocol &&
          url.host === trusted.host &&
          url.pathname === trusted.pathname &&
          url.username === trusted.username &&
          url.password === trusted.password &&
          (options.ignoreSearch === true || url.search === trusted.search) &&
          (options.ignoreHash === true || url.hash === trusted.hash)
        );
      } catch {
        return false;
      }
    },
    {
      onRevoke(listener: (sender: IpcSender) => void): Cleanup {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  );
  return {
    authorize,
    grant(sender: Sender, documentUrl: URL): Cleanup {
      const grant = { sender, url: new URL(documentUrl.href) };
      const previous = grants.has(sender);
      grants.set(sender, grant);
      if (previous) notify(sender);
      return () => {
        if (grants.get(sender) !== grant) return;
        grants.delete(sender);
        notify(sender);
      };
    },
  };
}
