# IPC

Validated Electron RPC in both directions, revisioned state, and transient events.
Pass Electron's `ipcMain` and `ipcRenderer` directly; the package has no Electron
runtime dependency. All incoming action arguments require a Standard Schema
validator (for example Zod or Valibot).

Use `@electron-spark/ipc/main` in main and `@electron-spark/ipc/renderer` in
preload. The renderer entry has no Node built-in imports and can be bundled into
a sandboxed preload. The root entry includes main APIs and therefore imports
`node:async_hooks`; do not bundle it into a sandboxed preload. Import application
action types with `import type` so main implementations stay in main.

## Commands, caller context, and state

```ts
import {
  createIpcApiServer,
  createIpcState,
  defineIpcAction,
  getIpcContext,
} from "@electron-spark/ipc/main";
// main/counter.ts
import { ipcMain, BrowserWindow } from "electron";
import { z } from "zod";

// Replace with your application's trusted WebContents + frame policy.
const authorize = (event) => event.senderFrame?.url === "app://desktop/index.html";

const count = await createIpcState("count", {
  initialState: 0,
  schema: z.number(),
  authorize,
});
const actions = {
  increment: defineIpcAction({
    params: z.tuple([]),
    handler: async () => {
      const { signal } = getIpcContext();
      await count.setState((current) => {
        signal.throwIfAborted();
        return current + 1;
      });
    },
  }),
  closeMyWindow: defineIpcAction({
    params: z.tuple([]),
    handler: () => {
      const { sender } = getIpcContext();
      // The structural sender type can be narrowed to Electron.WebContents in app code.
      BrowserWindow.fromWebContents(sender as Electron.WebContents)?.close();
    },
  }),
};
export type CounterActions = typeof actions;
const detachState = count.attach(ipcMain);
const detachApi = createIpcApiServer("counter", actions, { authorize }).attach(ipcMain);
// Call detachApi() and detachState() when the service is retired.
```

```ts
import { createIpcApiBridge, createIpcStateBridge } from "@electron-spark/ipc/renderer";
// preload.ts
import { contextBridge, ipcRenderer } from "electron";

import type { CounterActions } from "./main/counter";

const counter = createIpcApiBridge<CounterActions>(
  ipcRenderer,
  "counter",
  {
    increment: true,
    closeMyWindow: true,
  },
  { timeoutMs: 10_000 },
);
const count = createIpcStateBridge<number>(ipcRenderer, "count");
contextBridge.exposeInMainWorld("counter", counter);
contextBridge.exposeInMainWorld("count", count);
```

```ts
// renderer (declare the corresponding window types in your app)
const stopStatus = window.count.subscribeStatus((status) => renderConnection(status));
const stopUpdates = window.count.subscribe(renderCount, reportError);
await window.count.ready();
await window.counter.increment();
// On an explicit retry, after restoring the service/permission:
await window.count.reconnect();
// On retirement:
stopUpdates();
stopStatus();
await window.count.dispose();
```

`getIpcContext()` uses AsyncLocalStorage to isolate concurrent requests across
`await`. It exposes the authorized `frame`, `sender`, `channel`, `action`,
`requestId`, and cancellation `signal`. It throws outside an active request or
after its lifetime ends. Do not expose this context through contextBridge or
retain it as authority for background jobs.

Authorization precedes validation. Navigation (including a same-URL reload),
frame destruction, timeout, and server detachment abort the request; a pending
validator cannot subsequently start its handler. Results and arguments must be
`IpcData`. Optional `result` schemas validate outbound values. Schema transforms
use the input tuple in clients and the output tuple in handlers. `void` handlers
resolve to `undefined`. The runtime allowlist is exhaustive for the action type;
use `Pick<Actions, "name">` to expose a subset. `then` is reserved.

## Deadlines and cancellation

RPC, subscription initialization, authorization, state validators/updaters, and
reverse RPC default to a 30-second timeout. Set `timeoutMs` on the relevant
server or bridge; durations must be positive finite timer values. RPC bridge
options also accept an `AbortSignal`, applying to calls made through that bridge.
For individual cancellation, construct a bridge for that operation in preload,
or wrap it in an application API with explicit start/cancel methods. AbortSignal
is a local object; do not pass it through Electron contextBridge.

Renderer-to-main cancellation uses a separate request-ID protocol. Only the
original sender and frame can cancel the request. Main handlers must cooperate:
pass `getIpcContext().signal` to cancellable I/O and check it before side effects.
Timeouts cannot undo work already committed or forcibly interrupt JavaScript.
No mutations are automatically retried; a timeout may mean the result was lost
after a successful side effect. Closing the calling window may also prevent its
RPC response from arriving. Authorization callbacks themselves must eventually
release their own resources; the library bounds its wait and removes its watchers.

## State scope, revisions, and recovery

`setState(value)` and `setState(current => next)` validate and commit serially.
Functional updates run against the latest committed clone and may be async.
Rejected or timed-out updates do not poison the queue. Do not call `setState`
recursively from inside an updater. `getSnapshot()` returns `{ revision, data }`;
`setState(next, expectedRevision)` rejects conflicts at commit time. State revisions
are service-wide and begin at zero. Main reads, bridge reads, and deliveries own
cloned data, so a subscriber cannot mutate another subscriber's snapshot.

State is shared by default. Use a synchronous `select` projection to send only
what the authorized frame should see:

```ts
const settings = await createIpcState("settings", {
  initialState: initialSettings,
  schema: settingsSchema,
  authorize,
  select: (all, { sender, frame }) => {
    const windowId = lookupTrustedWindowId(sender, frame);
    return all.windows[windowId];
  },
});
```

The backing schema validates all state; the selector's output must be `IpcData`.
Declare the state bridge with the projected type. Selectors run for initial
snapshots and each commit; thrown projections disconnect only that subscriber.
Keep permission-sensitive filtering in the selector. Subscription authorization
runs at initialization, on heartbeat, and before publishing after a same-document
URL change; it is not a fresh authorization on every state update. Store window-specific data in a main-owned map/object and derive the
key from context, never from an unchecked renderer-supplied window ID.

Connection status is `idle`, `connecting`, `connected`, `disconnected`, or
`disposed`. `getState()` throws unless connected. `ready()` initializes or retries
and resolves to the initialization snapshot; use `getState()` for subsequent reads.
`reconnect()` retires the old token and obtains a fresh snapshot, accepting revision
zero from a replacement service. Late messages for old tokens are ignored.

Main sends explicit disconnect notices on detachment, navigation, and subscription
removal. Heartbeats detect notices lost to send failures or unreachable services:
by default they run every 5 seconds with a 30-second request timeout. Main expires
unrenewed leases after 30 seconds (`leaseMs`), bounding abandoned subscriptions.
When customizing `heartbeatMs`, keep it comfortably below the server lease; account
for event-loop suspension and policy latency. A detected disconnect clears cached
data and reports the error. Recovery is explicit; there is no retry loop.

Local unsubscribe removes a callback; the bridge retains its lease until
`dispose()`. Disposal is idempotent and completes locally immediately, including
when authorization never resolves. Remote release is best-effort, with pending
registration cancellation, late-response cleanup, and lease expiry as fallbacks.
No further update callbacks run after disposal. Dispose unused bridges to remove
their transport listeners. Callbacks are isolated from transport cleanup.

## Persistent state

Pass `storage` instead of `initialState` to load and persist state through a
`{ read, write }` adapter. Adapters from `@electron-spark/store` work directly:

```ts
import { createFileSystemAdaptor } from "@electron-spark/store";

const settings = await createIpcState("settings", {
  storage: createFileSystemAdaptor(settingsPath, { locale: "en" as "fr" | "en" }),
  schema: z.object({ locale: z.enum(["fr", "en"]) }),
  authorize,
});
await settings.setState((current) => ({ ...current, locale: "fr" }));
```

Creation reads once and validates the loaded value before returning. The adapter
provides defaults for missing files; read or validation errors reject creation.
Initialization does not write. Updates validate, await storage, then commit in
memory, increment the revision, and notify renderers. Failed writes reject the
update without changing the state or revision; later updates can still proceed.
Storage receives a clone of the validated value.

Storage I/O is awaited without a library timeout, keeping writes serialized even
when an RPC caller times out. Adapters must settle their operations and should
make failed writes leave the previous stored value intact (the filesystem adapter
uses atomic replacement). Revisions restart at zero and are not persisted. Use
this state as the sole writer: direct store writes and external file edits are
not watched or synchronized. A `Store` can be adapted with
`{ read: store.get, write: store.set }` when needed.

## Main → renderer requests

```ts
// preload: install validated handlers, optionally forwarding to an app callback.
import { createIpcRendererBridge, defineIpcAction } from "@electron-spark/ipc/renderer";
const rendererActions = {
  canClose: defineIpcAction({
    params: z.tuple([]),
    result: z.boolean(),
    handler: () => !hasUnsavedChanges(),
  }),
};
export type RendererActions = typeof rendererActions;
const stopRenderer = createIpcRendererBridge(ipcRenderer, "document", rendererActions);

// main: target a specific trusted frame (for example from an active IPC context).
import { createIpcRendererServer, getIpcContext } from "@electron-spark/ipc/main";
const renderer = createIpcRendererServer<RendererActions>(
  "document",
  { canClose: true },
  { authorize },
);
const detachRenderer = renderer.attach(ipcMain);
// Inside a main action:
const { sender, frame, signal } = getIpcContext();
const canClose = await renderer.client({ sender, senderFrame: frame }, { signal }).canClose();
```

Replies are accepted only from the exact target sender/frame and pending request
ID. Navigation, timeout, caller cancellation, or detachment rejects pending main
waiters. Renderer handlers have their own bounded wait; caller cancellation does
not interrupt already-running renderer work. Main requires a result schema for every action and validates renderer replies
before returning them to the caller. A valid response is still renderer-controlled
input; it must not grant authority by itself. Call `stopRenderer()` on preload
service retirement. Missing handlers or absent renderer bridges reject or time out.

## Transient events

```ts
// main
const progress = createIpcEventSender("progress", z.number(), { authorize });
await progress.send({ sender, senderFrame: frame }, 50);
// preload
const progressBridge = createIpcEventBridge(ipcRenderer, "progress", z.number());
contextBridge.exposeInMainWorld("progress", progressBridge);
// renderer
const stopProgress = window.progress.subscribe(renderProgress, reportError);
```

Import `createIpcEventSender` from `/main` and `createIpcEventBridge` from `/renderer`.
Events target an explicitly authorized frame and validate data on both sides.
There is no replay, acknowledgment, buffering, or delivery guarantee. Async event
validation may complete out of order; use sequence numbers if order matters.
Use state for durable progress and events for optional transient notifications.
Renderer-to-main notifications can be ordinary `void` actions.

## Data, errors, and checks

`IpcData` is plain acyclic data: strings, numbers, booleans, null, undefined,
arrays, and plain objects. Shared references are allowed. Functions, symbols,
class instances, dates, maps, and typed arrays are deliberately excluded.
Errors transport `{ name, message }`, plus stacks only when `includeErrorStack`
is enabled; custom error fields and validation issue arrays are not transported.

This changes the RPC wire format; update main and preload together. `src/old/`
is archival, excluded from compilation, and not exported.

With Node 24 or newer, run `pnpm test`, `pnpm typecheck`, and `pnpm build` in this
directory. Tests use a cloning in-memory transport and cover types, authorization,
concurrency, lifetime races, recovery, state projections, events, and reverse RPC.
They do not launch Electron windows. The transport follows Electron's
[frame API](https://www.electronjs.org/docs/latest/api/web-frame-main); caller
context uses Node's [AsyncLocalStorage](https://nodejs.org/api/async_context.html).

## State services and document grants

`createIpcService` optionally combines state and commands on the same channel.
It accepts the options of `createIpcState` (including either `initialState` or
`storage`) plus an `actions(state)` factory. It returns `state`, `actions`, and
`attach(ipcMain)`. Attachment rolls back if either server fails; the returned
cleanup detaches both servers and can be called repeatedly. State remains usable
in main after detachment, and the service can be attached again.

```ts
import { createIpcAccessPolicy, createIpcService, defineIpcAction } from "@electron-spark/ipc/main";
import { app, ipcMain } from "electron";
import { z } from "zod";

const access = createIpcAccessPolicy();
const counter = await createIpcService("counter", {
  initialState: 0,
  schema: z.number(),
  authorize: access.authorize,
  actions: (state) => ({
    increment: defineIpcAction({
      params: z.tuple([]),
      handler: () => state.setState((value) => value + 1),
    }),
  }),
});
const detach = counter.attach(ipcMain);
app.once("will-quit", detach);
// Supply the window and trusted URL chosen by your application.
const revoke = access.grant(window.webContents, trustedDocumentUrl);
// Call revoke() when this window should lose access.
```

Grants require the registered sender's current main frame and a matching document
URL, including search and hash by default. Opt into `{ ignoreSearch: true,
ignoreHash: true }` when routing uses those components. Pass a trusted URL from
application configuration, not the sender's requested URL. The policy uses
structural interfaces and does not import Electron. It can also authorize a
standalone API server or state server.

Revoking or replacing a grant immediately disconnects that sender's state
subscriptions and aborts pending API requests and subscriptions. An old grant's
cleanup cannot revoke its replacement. Cancellation cannot undo actions already
performed; running handlers should observe `getIpcContext().signal` before further
side effects. A new grant permits new requests and explicit state reconnection.
Pass `access.authorize` directly to preserve its `onRevoke` notification hook;
custom authorization wrappers must forward that hook to retain immediate
revocation. Application code owns window selection and process shutdown;
storage adapters own file paths, defaults, and migrations.
