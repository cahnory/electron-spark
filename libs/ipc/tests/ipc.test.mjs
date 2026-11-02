import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileSystemAdaptor } from "@electron-spark/store";

import { assertIpcData } from "../src/data.ts";
import {
  createIpcAccessPolicy,
  createIpcService,
  defineIpcAction,
  createIpcApiServer,
  createIpcApiBridge,
  createIpcState,
  createIpcStateBridge,
  createIpcRendererServer,
  createIpcRendererBridge,
  createIpcEventSender,
  createIpcEventBridge,
} from "../src/index.ts";
import { getIpcContext } from "../src/main.ts";
import { readResponse } from "../src/response.ts";
import { getChannel } from "../src/transport.ts";

const schema = (check) => ({
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => (check(value) ? { value } : { issues: [{ message: "Invalid input" }] }),
  },
});
const numbers = schema(
  (args) =>
    Array.isArray(args) && args.length === 2 && args.every((arg) => typeof arg === "number"),
);
const number = schema((value) => typeof value === "number");
const anyData = schema(() => true);
const noArgs = schema((args) => Array.isArray(args) && args.length === 0);
const tick = () => new Promise((resolve) => setImmediate(resolve));
function transport() {
  const handlers = new Map();
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  const events = new EventEmitter();
  const frame = {
    parent: null,
    processId: 1,
    routingId: 1,
    url: "app://test/",
    isDestroyed: () => false,
    send: (channel, value) => events.emit(channel, {}, structuredClone(value)),
  };
  const event = { sender, senderFrame: frame };
  const main = {
    handle(channel, listener) {
      if (handlers.has(channel)) throw new Error("Duplicate handler");
      handlers.set(channel, listener);
    },
    removeHandler: (channel) => handlers.delete(channel),
  };
  const renderer = {
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error("Missing handler");
      return structuredClone(await handler(event, ...structuredClone(args)));
    },
    on: (channel, callback) => events.on(channel, callback),
    removeListener: (channel, callback) => events.removeListener(channel, callback),
  };
  return { main, renderer, handlers, sender, event, events, frame };
}
const authorize = () => true;

void test("RPC supports sync/async handlers, Unicode channels, validation, and allowlisted methods", async () => {
  const t = transport();
  let calls = 0;
  const actions = {
    add: defineIpcAction({
      params: numbers,
      handler: (a, b) => {
        calls++;
        return a + b;
      },
      result: number,
    }),
    asyncAdd: defineIpcAction({ params: numbers, handler: async (a, b) => a + b }),
  };
  const server = createIpcApiServer("数学", actions, { authorize });
  const detach = server.attach(t.main);
  const client = createIpcApiBridge(t.renderer, "数学", { add: true, asyncAdd: true });
  assert.equal(await client.add(2, 3), 5);
  assert.equal(await client.asyncAdd(2, 4), 6);
  await assert.rejects(client.add("bad", 1), { name: "IpcValidationError" });
  assert.equal(calls, 1);
  assert.equal(client.then, undefined);
  assert.equal(Reflect.get(client, "toString"), undefined);
  assert.equal(await Promise.resolve(client), client);
  assert.equal(server.isAttachedTo(t.main), true);
  assert.throws(() => server.attach(t.main), /already attached/);
  detach();
  detach();
  assert.equal(t.handlers.size, 0);
  assert.equal(server.isAttachedTo(t.main), false);
});

void test("RPC rejects sync exceptions, async rejections, thrown strings, and invalid output", async () => {
  const t = transport();
  const actions = {
    sync: defineIpcAction({
      params: noArgs,
      handler: () => {
        throw new TypeError("sync");
      },
    }),
    async: defineIpcAction({
      params: noArgs,
      handler: async () => {
        throw new Error("async");
      },
    }),
    string: defineIpcAction({
      params: noArgs,
      handler: () => {
        throw "string";
      },
    }),
    invalid: defineIpcAction({ params: noArgs, handler: () => new Date() }),
    wrong: defineIpcAction({ params: noArgs, handler: () => "bad", result: number }),
  };
  createIpcApiServer("errors", actions, { authorize }).attach(t.main);
  const client = createIpcApiBridge(
    t.renderer,
    "errors",
    Object.fromEntries(Object.keys(actions).map((key) => [key, true])),
  );
  await Promise.all(
    ["sync", "async", "string"].map((name) => assert.rejects(client[name](), new RegExp(name))),
  );
  await assert.rejects(client.invalid(), /plain objects/);
  await assert.rejects(client.wrong(), { name: "IpcValidationError" });
  const response = await t.renderer.invoke(getChannel("call", "errors", "sync"));
  assert.equal(Object.hasOwn(response.error, "stack"), false);
});

void test("authorization precedes validation and handler execution", async () => {
  const t = transport();
  let invoked = false;
  const action = defineIpcAction({
    params: noArgs,
    handler: () => {
      invoked = true;
      return 1;
    },
  });
  createIpcApiServer(
    "private",
    { action },
    {
      authorize: async (event, name) => {
        assert.equal(event.senderFrame, t.frame);
        assert.equal(name, "action");
        return false;
      },
    },
  ).attach(t.main);
  await assert.rejects(
    createIpcApiBridge(t.renderer, "private", { action: true }).action(),
    /access denied/,
  );
  assert.equal(invoked, false);
});

void test("partial attachment rolls back without removing existing handlers", () => {
  const t = transport();
  const occupied = getChannel("call", "rollback", "b");
  const existing = authorize;
  t.main.handle(occupied, existing);
  const action = defineIpcAction({ params: noArgs, handler: () => 1 });
  const server = createIpcApiServer("rollback", { a: action, b: action }, { authorize });
  assert.throws(() => server.attach(t.main), /Duplicate/);
  assert.deepEqual([...t.handlers.entries()], [[occupied, existing]]);
  assert.equal(server.isAttachedTo(t.main), false);
});

void test("response envelopes accept undefined and optional stacks, reject malformed values", () => {
  assert.equal(readResponse({ ok: true, data: undefined }), undefined);
  assert.throws(() => readResponse({ ok: true }), /Invalid IPC response/);
  assert.throws(() => readResponse({ ok: false, error: { name: "Test", message: "expected" } }), {
    name: "Test",
    message: "expected",
  });
  assert.throws(
    () => readResponse({ ok: false, error: { name: "Test", message: "expected", stack: 123 } }),
    /Invalid IPC response/,
  );
});

void test("plain data rejects cycles and instances, permits shared references", () => {
  const item = { a: 1 };
  assert.doesNotThrow(() => assertIpcData([undefined, item, item]));
  const cycle = {};
  cycle.self = cycle;
  for (const value of [cycle, new Date(), { fn() {} }, Symbol("x")])
    assert.throws(() => assertIpcData(value));
});

void test("undefined state initializes once, subscribers are isolated, disposal is idempotent", async () => {
  const t = transport();
  const state = await createIpcState("state", {
    initialState: undefined,
    schema: anyData,
    authorize,
  });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "state");
  assert.throws(() => bridge.getState(), /not ready/);
  const updates = [],
    errors = [];
  bridge.subscribe(
    () => {
      throw new Error("subscriber");
    },
    (error) => errors.push(error),
  );
  const unsubscribe = bridge.subscribe(
    (data) => updates.push(data),
    (error) => errors.push(error),
  );
  assert.equal(await bridge.ready(), undefined);
  assert.equal(await bridge.ready(), undefined);
  assert.equal(bridge.getState(), undefined);
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  await state.setState(1);
  assert.deepEqual(updates, [undefined, 1]);
  assert.equal(errors.length, 2);
  unsubscribe();
  unsubscribe();
  await state.setState(2);
  assert.deepEqual(updates, [undefined, 1]);
  const disposal = bridge.dispose();
  assert.equal(bridge.dispose(), disposal);
  await disposal;
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.events.listenerCount(getChannel("state", "state")), 0);
  await assert.rejects(bridge.ready(), /disposed/);
  detach();
  detach();
  assert.equal(t.handlers.size, 0);
});

void test("newer updates arriving before the initial snapshot win", async () => {
  const t = transport();
  const state = await createIpcState("race", { initialState: 0, schema: number, authorize });
  state.attach(t.main);
  const invoke = t.renderer.invoke.bind(t.renderer);
  t.renderer.invoke = async (channel, ...args) => {
    const response = await invoke(channel, ...args);
    if (channel === getChannel("state-subscribe", "race")) await state.setState(1);
    return response;
  };
  const bridge = createIpcStateBridge(t.renderer, "race");
  const updates = [];
  bridge.subscribe((value) => updates.push(value), assert.fail);
  assert.equal(await bridge.ready(), 1);
  assert.deepEqual(updates, [1]);
  await bridge.dispose();
});

void test("disposing during initialization unregisters after authorization completes", async () => {
  const t = transport();
  let allow;
  const allowed = new Promise((resolve) => {
    allow = resolve;
  });
  const state = await createIpcState("pending", {
    initialState: 0,
    schema: number,
    authorize: async () => {
      await allowed;
      return true;
    },
  });
  state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "pending");
  const initialized = assert.rejects(bridge.ready(), /disposed/);
  const disposal = bridge.dispose();
  allow();
  await Promise.all([initialized, disposal]);
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.events.listenerCount(getChannel("state", "pending")), 0);
});

void test("state validates and orders commits; invalid commits do not poison the queue", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const delayed = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: async (value) => {
        if (value === 1) await gate;
        return typeof value === "number" ? { value } : { issues: [{ message: "number required" }] };
      },
    },
  };
  const state = await createIpcState("ordered", { initialState: 0, schema: delayed, authorize });
  const first = state.setState(1);
  const second = state.setState(2);
  await tick();
  assert.equal(state.getState(), 0);
  release();
  await Promise.all([first, second]);
  assert.equal(state.getState(), 2);
  await assert.rejects(state.setState("bad"), /validation failed/);
  await state.setState(3);
  assert.equal(state.getState(), 3);
});

const check = (value) =>
  typeof value.nested.count === "number" ? { value } : { issues: [{ message: "number required" }] };

void test("initial state owns nested data before validation yields", async () => {
  await Promise.all(
    [false, true].map(async (asynchronous) => {
      const initial = { nested: { count: 1 } };
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const validator = {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: asynchronous
            ? async (value) => {
                await gate;
                return check(value);
              }
            : check,
        },
      };
      const pending = createIpcState("initial-ownership", {
        initialState: initial,
        schema: validator,
        authorize,
      });
      initial.nested.count = "invalid";
      release();
      const state = await pending;
      assert.deepEqual(state.getState(), { nested: { count: 1 } });
    }),
  );
});

void test("state snapshots own their data and destroyed senders are removed", async () => {
  const t = transport();
  const initial = { count: 0 };
  const state = await createIpcState("ownership", {
    initialState: initial,
    schema: anyData,
    authorize,
  });
  state.attach(t.main);
  initial.count = 9;
  const read = state.getState();
  read.count = 8;
  assert.equal(state.getState().count, 0);
  const bridge = createIpcStateBridge(t.renderer, "ownership");
  await bridge.ready();
  t.sender.emit("destroyed");
  await state.setState({ count: 1 });
  assert.throws(() => bridge.getState(), /disconnected/);
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  await bridge.dispose();
});

void test("state subscriptions are frame-scoped and cannot be removed by another frame", async () => {
  const t = transport();
  const state = await createIpcState("secure", { initialState: 0, schema: number, authorize });
  state.attach(t.main);
  const response = await t.renderer.invoke(getChannel("state-subscribe", "secure"), "token");
  assert.equal(response.ok, true);
  const original = t.event.senderFrame;
  t.event.senderFrame = { url: "app://test/", isDestroyed: () => false, send() {} };
  const removal = await t.renderer.invoke(getChannel("state-unsubscribe", "secure"), "token");
  assert.equal(removal.ok, false);
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  t.event.senderFrame = original;
  await t.renderer.invoke(getChannel("state-unsubscribe", "secure"), "token");
  assert.equal(t.sender.listenerCount("destroyed"), 0);
});

void test("state drops stale revisions and ignores messages for other bridges", async () => {
  const t = transport();
  let token;
  const state = await createIpcState("revisions", { initialState: 0, schema: number, authorize });
  state.attach(t.main);
  const invoke = t.renderer.invoke.bind(t.renderer);
  t.renderer.invoke = (channel, ...args) => {
    if (channel === getChannel("state-subscribe", "revisions")) token = args[0];
    return invoke(channel, ...args);
  };
  const bridge = createIpcStateBridge(t.renderer, "revisions");
  const errors = [];
  bridge.subscribe(
    () => {},
    (error) => errors.push(error),
  );
  await bridge.ready();
  await state.setState(1);
  const update = (payload) => t.events.emit(getChannel("state", "revisions"), {}, payload);
  update({ token, revision: 0, data: 99 });
  update({ token: "other", revision: 100, data: 99 });
  update({ token, revision: -1, data: 99 });
  assert.equal(bridge.getState(), 1);
  assert.equal(errors.length, 1);
  await bridge.dispose();
});

void test("state removes subscriptions when a frame navigates to another URL", async () => {
  const t = transport();
  const state = await createIpcState("navigation", { initialState: 0, schema: number, authorize });
  state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "navigation");
  await bridge.ready();
  t.frame.url = "https://untrusted.example/";
  t.sender.emit(
    "did-frame-navigate",
    {},
    t.frame.url,
    200,
    "OK",
    true,
    t.frame.processId,
    t.frame.routingId,
  );
  await state.setState(1);
  assert.throws(() => bridge.getState(), /disconnected/);
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  await bridge.dispose();
});

void test("navigation during async authorization cannot invoke handlers", async () => {
  const t = transport();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const action = defineIpcAction({
    params: noArgs,
    handler: () => {
      calls++;
      return 1;
    },
  });
  createIpcApiServer(
    "auth-race",
    { action },
    {
      authorize: async () => {
        await pending;
        return true;
      },
    },
  ).attach(t.main);
  const result = createIpcApiBridge(t.renderer, "auth-race", { action: true }).action();
  t.frame.url = "https://other.example/";
  release();
  await assert.rejects(result, /changed during authorization/);
  assert.equal(calls, 0);
});

void test("shared-reference validation visits each distinct object once and still detects cycles", (context) => {
  let value = { value: 1 };
  const depth = 12;
  for (let index = 0; index < depth; index++) value = { left: value, right: value };
  const values = context.mock.method(Object, "values");
  assertIpcData(value);
  assert.equal(values.mock.callCount(), depth + 1);
  const shared = {};
  const cyclic = { left: shared, right: shared };
  shared.back = cyclic;
  assert.throws(() => assertIpcData(cyclic), /cycles/);
});

void test("sync and async side-effect handlers transport undefined", async () => {
  const t = transport();
  let calls = 0;
  const actions = {
    sync: defineIpcAction({
      params: noArgs,
      handler: () => {
        calls++;
      },
    }),
    async: defineIpcAction({
      params: noArgs,
      handler: async () => {
        calls++;
      },
    }),
  };
  const detach = createIpcApiServer("commands", actions, { authorize }).attach(t.main);
  const client = createIpcApiBridge(t.renderer, "commands", { sync: true, async: true });
  assert.equal(await client.sync(), undefined);
  assert.equal(await client.async(), undefined);
  assert.equal(calls, 2);
  detach();
});

void test("owners can dispose after authorization is revoked; other frames still cannot unsubscribe", async () => {
  const t = transport();
  let allowed = true;
  const state = await createIpcState("revoked", {
    initialState: 0,
    schema: number,
    authorize: () => allowed,
  });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "revoked");
  await bridge.ready();
  allowed = false;
  await bridge.dispose();
  await bridge.dispose();
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
  const denied = createIpcStateBridge(t.renderer, "revoked");
  await assert.rejects(denied.ready(), /access denied/);
  await denied.dispose();
  detach();
});

void test("removed child frames are cleaned up while state is idle", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const t = transport();
  const state = await createIpcState("idle", { initialState: 0, schema: number, authorize });
  const detach = state.attach(t.main);
  const child = {
    parent: t.frame,
    processId: 1,
    routingId: 2,
    url: "app://child/",
    isDestroyed: () => false,
    send() {},
  };
  t.event.senderFrame = child;
  const bridge = createIpcStateBridge(t.renderer, "idle");
  await bridge.ready();
  child.isDestroyed = () => true;
  context.mock.timers.tick(1000);
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
  // Removal happened without a setState call or WebContents destruction.
  assert.equal(state.getState(), 0);
  await bridge.dispose();
  detach();
});

void test("document navigation cleans only the affected frame and its descendants, including reloads", async () => {
  const t = transport();
  const state = await createIpcState("frames", { initialState: 0, schema: number, authorize });
  const detach = state.attach(t.main);
  const child = {
    parent: t.frame,
    processId: 1,
    routingId: 2,
    url: "app://child/",
    isDestroyed: () => false,
    send() {},
  };
  const grandchild = {
    parent: child,
    processId: 1,
    routingId: 3,
    url: "app://grandchild/",
    isDestroyed: () => false,
    send() {},
  };
  const frames = [
    ["main", t.frame],
    ["child", child],
    ["grandchild", grandchild],
  ];
  const subscribe = t.handlers.get(getChannel("state-subscribe", "frames"));
  await Promise.all(
    frames.map(async ([token, frame]) => {
      readResponse(await subscribe({ ...t.event, senderFrame: frame }, token));
    }),
  );
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 1);
  const sent = [];
  for (const [, frame] of frames)
    frame.send = (channel, value) => {
      if (channel === getChannel("state", "frames")) sent.push(value.token);
    };
  child.url += "?tab=settings#/profile";
  await new Promise((resolve) => setTimeout(resolve, 1100));
  // Same-document events do not retire the current document's subscriptions.
  t.sender.emit("did-start-navigation", { frame: child, isMainFrame: false, isSameDocument: true });
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  // A navigation attempt that never commits must also preserve the subscription.
  t.sender.emit("did-start-navigation", {
    frame: child,
    isMainFrame: false,
    isSameDocument: false,
  });
  await state.setState(1);
  assert.deepEqual(
    sent.toSorted((a, b) => a.localeCompare(b)),
    ["child", "grandchild", "main"],
  );
  sent.length = 0;
  // URL stays identical, as it does on reload.
  t.sender.emit(
    "did-frame-navigate",
    {},
    child.url,
    200,
    "OK",
    false,
    child.processId,
    child.routingId,
  );
  await state.setState(2);
  assert.deepEqual(sent, ["main"]);
  t.sender.emit(
    "did-frame-navigate",
    {},
    t.frame.url,
    200,
    "OK",
    true,
    t.frame.processId,
    t.frame.routingId,
  );
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
  detach();
});

void test("lifecycle watchers are shared across state services and removed on detachment", async (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const t = transport();
  const first = await createIpcState("first", { initialState: 0, schema: number, authorize });
  const second = await createIpcState("second", { initialState: 0, schema: number, authorize });
  const detachFirst = first.attach(t.main);
  const detachSecond = second.attach(t.main);
  const bridges = [
    createIpcStateBridge(t.renderer, "first"),
    createIpcStateBridge(t.renderer, "second"),
  ];
  await Promise.all(bridges.map((bridge) => bridge.ready()));
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 1);
  detachFirst();
  assert.equal(t.sender.listenerCount("destroyed"), 1);
  detachSecond();
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
  // A retired watcher must not send or restore lifecycle listeners on later ticks.
  context.mock.timers.tick(2000);
  assert.equal(t.sender.listenerCount("destroyed"), 0);
});

void test("caller context survives awaits and isolates concurrent frames", async () => {
  const t = transport();
  const second = { ...t.frame, routingId: 2 };
  const action = defineIpcAction({
    params: noArgs,
    handler: async () => {
      const before = getIpcContext();
      await tick();
      assert.equal(getIpcContext(), before);
      assert.equal(before.sender, t.sender);
      return before.frame.routingId;
    },
  });
  const detach = createIpcApiServer("context", { action }, { authorize }).attach(t.main);
  const handler = t.handlers.get(getChannel("call", "context", "action"));
  const values = await Promise.all(
    [t.frame, second].map((frame, index) =>
      handler({ sender: t.sender, senderFrame: frame }, { id: String(index), args: [] }),
    ),
  );
  assert.deepEqual(values.map(readResponse), [1, 2]);
  assert.throws(getIpcContext, /No active/);
  detach();
});

void test("timeouts and AbortSignal cancel main work and release pending authorization", async () => {
  const t = transport();
  let signal;
  const action = defineIpcAction({
    params: noArgs,
    handler: () => {
      signal = getIpcContext().signal;
      return new Promise(() => {});
    },
  });
  const detach = createIpcApiServer("timeout", { action }, { authorize }).attach(t.main);
  await assert.rejects(
    createIpcApiBridge(t.renderer, "timeout", { action: true }, { timeoutMs: 10 }).action(),
    /timed out/,
  );
  await tick();
  assert.equal(signal.aborted, true);
  const controller = new AbortController();
  const result = createIpcApiBridge(
    t.renderer,
    "timeout",
    { action: true },
    { signal: controller.signal },
  ).action();
  await tick();
  controller.abort(new Error("user cancelled"));
  await assert.rejects(result, /user cancelled/);
  await tick();
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  detach();
  const detachPending = createIpcApiServer(
    "auth-never",
    { action },
    { authorize: () => new Promise(() => {}) },
  ).attach(t.main);
  await assert.rejects(
    createIpcApiBridge(t.renderer, "auth-never", { action: true }, { timeoutMs: 10 }).action(),
    /timed out/,
  );
  await tick();
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  detachPending();
});

void test("same URL reload during async argument validation prevents handler execution", async () => {
  const t = transport();
  let release;
  let called = false;
  const validator = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () =>
        new Promise((resolve) => {
          release = () => resolve({ value: [] });
        }),
    },
  };
  const action = defineIpcAction({
    params: validator,
    handler: () => {
      called = true;
    },
  });
  const detach = createIpcApiServer("validation-navigation", { action }, { authorize }).attach(
    t.main,
  );
  const result = createIpcApiBridge(t.renderer, "validation-navigation", { action: true }).action();
  const rejected = assert.rejects(result, /sender changed/);
  await tick();
  t.sender.emit("did-frame-navigate", {}, t.frame.url, 200, "OK", true, 1, 1);
  release();
  await rejected;
  assert.equal(called, false);
  detach();
});

void test("state projections isolate windows and functional updates serialize with revision checks", async () => {
  const t = transport();
  const second = { ...t.frame, routingId: 2, send() {} };
  const state = await createIpcState("views", {
    initialState: { count: 0, secret: "main only" },
    schema: anyData,
    authorize,
    select: (data, { frame }) => ({ count: data.count, window: frame.routingId }),
  });
  const detach = state.attach(t.main);
  const subscribe = t.handlers.get(getChannel("state-subscribe", "views"));
  const one = readResponse(await subscribe(t.event, "one"));
  const two = readResponse(await subscribe({ sender: t.sender, senderFrame: second }, "two"));
  assert.deepEqual(one.data, { count: 0, window: 1 });
  assert.deepEqual(two.data, { count: 0, window: 2 });
  await Promise.all(
    Array.from({ length: 10 }, () =>
      state.setState(async (data) => {
        await tick();
        return { ...data, count: data.count + 1 };
      }),
    ),
  );
  assert.equal(state.getState().count, 10);
  await assert.rejects(
    state.setState((data) => data, 0),
    /revision conflict/,
  );
  assert.equal(state.getSnapshot().revision, 10);
  detach();
});

void test("detach invalidates cached state and reconnect accepts a restarted server revision", async () => {
  const t = transport();
  const state = await createIpcState("recover", { initialState: 1, schema: number, authorize });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "recover");
  const statuses = [];
  bridge.subscribeStatus((status) => statuses.push(status));
  await bridge.ready();
  await state.setState(2);
  detach();
  assert.equal(bridge.getStatus(), "disconnected");
  assert.throws(() => bridge.getState(), /disconnected/);
  const replacement = await createIpcState("recover", {
    initialState: 10,
    schema: number,
    authorize,
  });
  const detachAgain = replacement.attach(t.main);
  assert.equal(await bridge.reconnect(), 10);
  assert.equal(bridge.getState(), 10);
  assert.deepEqual(statuses, [
    "idle",
    "connecting",
    "connected",
    "disconnected",
    "connecting",
    "connected",
  ]);
  await bridge.dispose();
  detachAgain();
});

void test("heartbeat detects lost disconnect messages and disposal bounds unresolved authorization", async () => {
  const t = transport();
  const state = await createIpcState("heartbeat", { initialState: 0, schema: number, authorize });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "heartbeat", { heartbeatMs: 5, timeoutMs: 20 });
  await bridge.ready();
  t.frame.send = () => {
    throw new Error("send failed");
  };
  await state.setState(1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(bridge.getStatus(), "disconnected");
  await bridge.dispose();
  detach();
  const pending = await createIpcState("never", {
    initialState: 0,
    schema: number,
    authorize: () => new Promise(() => {}),
  });
  const stop = pending.attach(t.main);
  const other = createIpcStateBridge(t.renderer, "never");
  const rejected = assert.rejects(other.ready(), /disposed/);
  await tick();
  await other.dispose();
  await rejected;
  await tick();
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  stop();
});

void test("reverse RPC validates handlers, rejects spoofed replies, and handles detachment", async () => {
  const t = transport();
  const server = createIpcRendererServer(
    "reverse",
    { add: true, never: true },
    { authorize, results: { add: number, never: anyData } },
  );
  const detach = server.attach(t.main);
  const stop = createIpcRendererBridge(t.renderer, "reverse", {
    add: defineIpcAction({ params: numbers, handler: (a, b) => a + b }),
    never: defineIpcAction({ params: noArgs, handler: () => new Promise(() => {}) }),
  });
  const client = server.client(t.event);
  assert.equal(await client.add(2, 4), 6);
  await assert.rejects(client.add("bad", 4), /validation/);
  const reply = t.handlers.get(getChannel("renderer-reply", "reverse"));
  const spoof = await reply({ sender: t.sender, senderFrame: { ...t.frame } }, "unknown", {
    ok: true,
    data: 99,
  });
  assert.equal(spoof.ok, false);
  const pending = assert.rejects(client.never(), /disposed/);
  await tick();
  detach();
  stop();
  await pending;
  assert.equal(t.sender.listenerCount("destroyed"), 0);
});

void test("reverse RPC timeout prevents a handler from starting after validation", async () => {
  const t = transport();
  let finishValidation;
  let calls = 0;
  const server = createIpcRendererServer("slow-renderer", { action: true }, { authorize });
  const detach = server.attach(t.main);
  const stop = createIpcRendererBridge(
    t.renderer,
    "slow-renderer",
    {
      action: defineIpcAction({
        params: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: () =>
              new Promise((resolve) => {
                finishValidation = resolve;
              }),
          },
        },
        handler: () => {
          calls++;
        },
      }),
    },
    { timeoutMs: 5 },
  );
  try {
    await assert.rejects(server.client(t.event).action(), /timed out/);
    finishValidation({ value: [] });
    await tick();
    assert.equal(calls, 0);
  } finally {
    stop();
    detach();
  }
});

for (const failure of ["denied", "throws", "timeout"]) {
  void test(`failed heartbeat removes only the owning subscription: ${failure}`, async () => {
    const t = transport();
    let allowed = true;
    const state = await createIpcState("heartbeat-revoked", {
      initialState: 0,
      schema: number,
      timeoutMs: 10,
      authorize: () => {
        if (allowed) return true;
        if (failure === "throws") throw new Error("Authorization failed");
        if (failure === "timeout") return new Promise(() => {});
        return false;
      },
    });
    const detach = state.attach(t.main);
    const updates = [];
    t.events.on(getChannel("state", state.channel), (_event, update) => updates.push(update));
    try {
      readResponse(await t.renderer.invoke(getChannel("state-subscribe", state.channel), "owner"));
      allowed = false;
      const ping = t.handlers.get(getChannel("state-ping", state.channel));
      const spoofed = await Promise.all(
        [
          { sender: t.sender, senderFrame: { ...t.frame } },
          { sender: new EventEmitter(), senderFrame: t.frame },
        ].map((stranger) => ping(stranger, "owner")),
      );
      assert.ok(spoofed.every((response) => response.ok === false));
      await state.setState(1);
      assert.equal(updates.length, 1);
      assert.equal((await ping(t.event, "owner")).ok, false);
      await state.setState(2);
      assert.equal(updates.length, 1);
      assert.equal(t.sender.listenerCount("destroyed"), 0);
    } finally {
      detach();
    }
  });
}

void test("transient events validate payloads and remove listeners", async () => {
  const t = transport();
  const sender = createIpcEventSender("progress", number, { authorize });
  const bridge = createIpcEventBridge(t.renderer, "progress", number);
  const received = [];
  const stop = bridge.subscribe((value) => received.push(value), assert.fail);
  await sender.send(t.event, 20);
  await tick();
  assert.deepEqual(received, [20]);
  await assert.rejects(sender.send(t.event, "invalid"), /validation/);
  stop();
  await sender.send(t.event, 30);
  assert.deepEqual(received, [20]);
});

void test("foreign frames cannot cancel another frame's pending request", async () => {
  const t = transport();
  let release;
  const action = defineIpcAction({
    params: noArgs,
    handler: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const stop = createIpcApiServer("cancel-owner", { action }, { authorize }).attach(t.main);
  const call = t.handlers.get(getChannel("call", "cancel-owner", "action"));
  const pending = call(t.event, { id: "owned", args: [] });
  await tick();
  const cancel = t.handlers.get(getChannel("cancel", "cancel-owner"));
  await cancel({ sender: t.sender, senderFrame: { ...t.frame } }, "owned");
  release(42);
  assert.equal(readResponse(await pending), 42);
  stop();
});

void test("state initialization can be disposed inside an update callback", async () => {
  const t = transport();
  const state = await createIpcState("callback-dispose", {
    initialState: 0,
    schema: number,
    authorize,
  });
  const stop = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "callback-dispose");
  bridge.subscribe(() => {
    void bridge.dispose();
  }, assert.fail);
  await assert.rejects(bridge.ready(), /disposed/);
  assert.equal(bridge.getStatus(), "disposed");
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  stop();
});

void test("abandoned state leases expire and timed-out updaters do not block later commits", async () => {
  const t = transport();
  const state = await createIpcState("lease", {
    initialState: 0,
    schema: number,
    authorize,
    leaseMs: 10,
    timeoutMs: 10,
  });
  const stop = state.attach(t.main);
  readResponse(await t.renderer.invoke(getChannel("state-subscribe", "lease"), "abandoned"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(t.sender.listenerCount("destroyed"), 0);
  await assert.rejects(
    state.setState(() => new Promise(() => {})),
    /timed out/,
  );
  await state.setState((value) => value + 1);
  assert.equal(state.getState(), 1);
  stop();
});

void test("main validates reverse responses and rejects a spoofed active request reply", async () => {
  const t = transport();
  const server = createIpcRendererServer(
    "untrusted-response",
    { value: true },
    { authorize, results: { value: number } },
  );
  const stop = server.attach(t.main);
  let id;
  t.frame.send = (_channel, message) => {
    id = message.id;
  };
  const pending = server.client(t.event).value();
  const rejected = assert.rejects(pending, /validation/);
  await tick();
  const reply = t.handlers.get(getChannel("renderer-reply", "untrusted-response"));
  const spoof = await reply({ sender: t.sender, senderFrame: { ...t.frame } }, id, {
    ok: true,
    data: 99,
  });
  assert.equal(spoof.ok, false);
  await reply(t.event, id, { ok: true, data: "invalid" });
  await rejected;
  stop();
});

void test("persistent state validates loaded data and propagates read failures", async () => {
  let writes = 0;
  const storage = { read: async () => "invalid", write: () => writes++ };
  await assert.rejects(createIpcState("invalid-storage", { storage, schema: number, authorize }), {
    name: "IpcValidationError",
  });
  await assert.rejects(
    createIpcState("unreadable", {
      storage: {
        ...storage,
        read: () => {
          throw new Error("read failed");
        },
      },
      schema: number,
      authorize,
    }),
    /read failed/,
  );
  assert.equal(writes, 0);
});

void test("persistent state publishes only after saving and recovers from failed writes", async () => {
  const t = transport();
  let finishWrite;
  let fail = false;
  const writes = [];
  const storage = {
    read: () => 4,
    write: (value) => {
      writes.push(value);
      if (fail) throw new Error("disk full");
      return new Promise((resolve) => {
        finishWrite = resolve;
      });
    },
  };
  const state = await createIpcState("persist", { storage, schema: number, authorize });
  const stop = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "persist");
  const updates = [];
  bridge.subscribe((value) => updates.push(value), assert.fail);
  await bridge.ready();
  assert.deepEqual(state.getSnapshot(), { revision: 0, data: 4 });
  const first = state.setState((value) => value + 1);
  const second = state.setState((value) => value + 1);
  await tick();
  assert.deepEqual(writes, [5]);
  assert.equal(state.getState(), 4);
  assert.deepEqual(updates, [4]);
  finishWrite();
  await first;
  await tick();
  assert.deepEqual(writes, [5, 6]);
  assert.deepEqual(updates, [4, 5]);
  finishWrite();
  await second;
  fail = true;
  await assert.rejects(state.setState(7), /disk full/);
  assert.deepEqual(state.getSnapshot(), { revision: 2, data: 6 });
  assert.deepEqual(updates, [4, 5, 6]);
  await assert.rejects(state.setState("invalid"), { name: "IpcValidationError" });
  await assert.rejects(state.setState(9, 0), /revision conflict/);
  assert.deepEqual(writes, [5, 6, 7]);
  fail = false;
  const recovered = state.setState((value) => value + 2);
  await tick();
  finishWrite();
  await recovered;
  assert.deepEqual(updates, [4, 5, 6, 8]);
  await bridge.dispose();
  stop();
});

void test("persistent state works with filesystem adapters and owns saved data", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "ipc-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const storage = createFileSystemAdaptor(join(directory, "settings.json"), { locale: "en" });
  const locales = schema((value) => value?.locale === "en" || value?.locale === "fr");
  const state = await createIpcState("settings", { storage, schema: locales, authorize });
  assert.deepEqual(state.getState(), { locale: "en" });
  await state.setState({ locale: "fr" });
  const restarted = await createIpcState("settings", { storage, schema: locales, authorize });
  assert.deepEqual(restarted.getSnapshot(), { revision: 0, data: { locale: "fr" } });
  const isolated = await createIpcState("isolated", {
    storage: {
      read: () => ({ count: 0 }),
      write: (value) => {
        value.count = 999;
      },
    },
    schema: anyData,
    authorize,
  });
  await isolated.setState({ count: 1 });
  assert.deepEqual(isolated.getState(), { count: 1 });
});

void test("access grants bind sender, main frame and document with explicit URL matching", () => {
  const t = transport();
  t.sender.mainFrame = t.frame;
  const policy = createIpcAccessPolicy();
  assert.equal(policy.authorize(t.event, "read"), false);
  const trustedUrl = new URL(t.frame.url);
  const old = policy.grant(t.sender, trustedUrl);
  trustedUrl.pathname = "/changed";
  assert.equal(policy.authorize(t.event, "read"), true);
  assert.equal(policy.authorize({ ...t.event, sender: transport().sender }, "read"), false);
  assert.equal(policy.authorize({ ...t.event, senderFrame: { ...t.frame } }, "read"), false);
  assert.equal(policy.authorize({ ...t.event, senderFrame: null }, "read"), false);
  for (const url of [
    "app://other/",
    "app://test/other",
    "app://test/?q=1",
    "app://test/#route",
    "invalid",
  ]) {
    t.frame.url = url;
    assert.equal(policy.authorize(t.event, "read"), false);
  }
  t.frame.url = "app://test/";
  const revoke = policy.grant(t.sender, new URL(t.frame.url));
  old();
  assert.equal(policy.authorize(t.event, "read"), true);
  revoke();
  revoke();
  assert.equal(policy.authorize(t.event, "read"), false);
  const routed = createIpcAccessPolicy({ ignoreSearch: true, ignoreHash: true });
  routed.grant(t.sender, new URL(t.frame.url));
  t.frame.url += "?q=1#route";
  assert.equal(routed.authorize(t.event, "read"), true);
  t.sender.isDestroyed = () => true;
  assert.equal(routed.authorize(t.event, "read"), false);
});

void test("service composes persisted state and typed actions and rolls back partial attachment", async () => {
  const t = transport();
  let stored = 1;
  const service = await createIpcService("service", {
    schema: number,
    storage: {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
    },
    authorize,
    actions: (state) => ({
      increment: defineIpcAction({
        params: noArgs,
        handler: () => state.setState((value) => value + 1),
      }),
    }),
  });
  const collision = getChannel("call", "service", "increment");
  const existing = authorize;
  t.main.handle(collision, existing);
  assert.throws(() => service.attach(t.main), /Duplicate handler/);
  assert.equal(t.handlers.size, 1);
  assert.equal(t.handlers.get(collision), existing);
  t.main.removeHandler(collision);
  const detach = service.attach(t.main);
  assert.throws(() => service.attach(t.main), /already attached/);
  const api = createIpcApiBridge(t.renderer, "service", { increment: true });
  await api.increment();
  assert.equal(service.state.getState(), 2);
  assert.equal(stored, 2);
  detach();
  detach();
  assert.equal(t.handlers.size, 0);
  service.attach(t.main)();
});

void test("revoking or replacing a grant immediately disconnects subscriptions and denies commands", async () => {
  const t = transport();
  t.sender.mainFrame = t.frame;
  const access = createIpcAccessPolicy();
  let revoke = access.grant(t.sender, new URL(t.frame.url));
  const service = await createIpcService("grants", {
    initialState: 0,
    schema: number,
    authorize: access.authorize,
    actions: (state) => ({
      increment: defineIpcAction({
        params: noArgs,
        handler: () => state.setState((value) => value + 1),
      }),
    }),
  });
  const detach = service.attach(t.main);
  try {
    const updates = [];
    const statuses = [];
    t.events.on(getChannel("state", "grants"), (_event, value) => updates.push(value));
    t.events.on(getChannel("state-status", "grants"), (_event, value) => statuses.push(value));
    const exerciseRevocation = async (replace) => {
      readResponse(await t.renderer.invoke(getChannel("state-subscribe", "grants"), "owner"));
      if (replace) revoke = access.grant(t.sender, new URL(t.frame.url));
      else revoke();
      assert.equal(statuses.at(-1).status, "disconnected");
      await service.state.setState((value) => value + 1);
      assert.equal(updates.length, 0);
      if (!replace) {
        const api = createIpcApiBridge(t.renderer, "grants", { increment: true });
        await assert.rejects(api.increment(), /access denied/);
        revoke = access.grant(t.sender, new URL(t.frame.url));
      }
    };
    await exerciseRevocation(false);
    await exerciseRevocation(true);
    revoke();
  } finally {
    detach();
  }
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
});

void test("revocation cancels subscriptions awaiting authorization", async () => {
  const t = transport();
  t.sender.mainFrame = t.frame;
  const policy = createIpcAccessPolicy();
  const revoke = policy.grant(t.sender, new URL(t.frame.url));
  let resolve;
  const delayed = Object.assign(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    {
      onRevoke: policy.authorize.onRevoke,
    },
  );
  const state = await createIpcState("pending-grant", {
    initialState: 0,
    schema: number,
    authorize: delayed,
  });
  const detach = state.attach(t.main);
  try {
    const pending = t.renderer.invoke(getChannel("state-subscribe", state.channel), "pending");
    revoke();
    resolve(true);
    const response = await pending;
    assert.throws(() => readResponse(response), /access revoked/);
  } finally {
    detach();
  }
});

void test("revocation aborts a running API command and detachment removes policy listeners", async () => {
  const t = transport();
  t.sender.mainFrame = t.frame;
  const policy = createIpcAccessPolicy();
  const revoke = policy.grant(t.sender, new URL(t.frame.url));
  let signal;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const server = createIpcApiServer(
    "revoke-command",
    {
      wait: defineIpcAction({
        params: noArgs,
        handler: async () => {
          signal = getIpcContext().signal;
          started();
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
          signal.throwIfAborted();
        },
      }),
    },
    { authorize: policy.authorize },
  );
  const detach = server.attach(t.main);
  try {
    const api = createIpcApiBridge(t.renderer, "revoke-command", { wait: true });
    const pending = api.wait();
    await ready;
    revoke();
    assert.equal(signal.aborted, true);
    await assert.rejects(pending, /access revoked/);
  } finally {
    detach();
  }
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
});

void test("revocation cancels event validation and pending reverse replies", async () => {
  const t = transport();
  t.sender.mainFrame = t.frame;
  const policy = createIpcAccessPolicy();
  let revoke = policy.grant(t.sender, new URL(t.frame.url));
  let finish;
  const delayed = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  };
  const sent = [];
  t.frame.send = (...args) => sent.push(args);
  const sending = createIpcEventSender("revocation", delayed, { authorize: policy.authorize }).send(
    t.event,
    1,
  );
  const rejected = assert.rejects(sending, /access revoked/);
  await tick();
  revoke();
  await rejected;
  finish({ value: 1 });
  await tick();
  assert.deepEqual(sent, []);
  revoke = policy.grant(t.sender, new URL(t.frame.url));
  const server = createIpcRendererServer(
    "revocation",
    { read: true },
    { authorize: policy.authorize, results: { read: number } },
  );
  const detach = server.attach(t.main);
  const pending = server.client(t.event).read();
  const cancelled = assert.rejects(pending, /access revoked/);
  await tick();
  const id = sent[0][1].id;
  revoke();
  const reply = await t.renderer.invoke(getChannel("renderer-reply", "revocation"), id, {
    ok: true,
    data: 1,
  });
  assert.equal(reply.ok, false);
  await cancelled;
  detach();
  assert.equal(t.sender.listenerCount("did-frame-navigate"), 0);
});

for (const allowed of [false, true]) {
  void test(`same-document publication rechecks URL policy (allowed=${allowed})`, async () => {
    const t = transport();
    t.sender.mainFrame = t.frame;
    const access = createIpcAccessPolicy({ ignoreSearch: allowed, ignoreHash: allowed });
    const revoke = access.grant(t.sender, new URL(t.frame.url));
    const state = await createIpcState("route-policy", {
      initialState: 0,
      schema: number,
      authorize: access.authorize,
    });
    const detach = state.attach(t.main);
    const bridge = createIpcStateBridge(t.renderer, "route-policy");
    try {
      await bridge.ready();
      t.frame.url += "?tab=private#/settings";
      await state.setState(1);
      if (allowed) assert.equal(bridge.getState(), 1);
      else assert.throws(() => bridge.getState(), /disconnected/);
    } finally {
      await bridge.dispose();
      detach();
      revoke();
    }
  });
}

void test("status callbacks can join initialization without creating another registration", async () => {
  const t = transport();
  let checks = 0;
  const state = await createIpcState("reentrant-ready", {
    initialState: 1,
    schema: number,
    authorize: () => {
      checks++;
      return true;
    },
  });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "reentrant-ready");
  const nested = [];
  const stop = bridge.subscribeStatus((status) => {
    if (status === "connecting" && !nested.length) nested.push(bridge.ready());
  });
  try {
    const initial = bridge.ready();
    assert.equal(await initial, 1);
    assert.equal(nested.length, 1);
    assert.equal(await nested[0], 1);
    assert.equal(checks, 1);
  } finally {
    stop();
    await bridge.dispose();
    detach();
  }
});

void test("disposal in a connected callback cancels readiness without stale status delivery", async () => {
  const t = transport();
  const state = await createIpcState("status-disposal", {
    initialState: 1,
    schema: number,
    authorize,
  });
  const detach = state.attach(t.main);
  const bridge = createIpcStateBridge(t.renderer, "status-disposal");
  bridge.subscribeStatus((status) => {
    if (status === "connected") void bridge.dispose();
  });
  const statuses = [];
  bridge.subscribeStatus((status) => statuses.push(status));
  try {
    await assert.rejects(bridge.ready(), /disposed/);
    assert.deepEqual(statuses, ["idle", "connecting", "disposed"]);
  } finally {
    await bridge.dispose();
    detach();
  }
});

void test("reverse RPC captures arguments before asynchronous authorization", async () => {
  const t = transport();
  const gate = Promise.withResolvers();
  const server = createIpcRendererServer(
    "owned-args",
    { echo: true },
    { authorize: () => gate.promise, results: { echo: anyData } },
  );
  const detach = server.attach(t.main);
  const stop = createIpcRendererBridge(t.renderer, "owned-args", {
    echo: defineIpcAction({ params: anyData, handler: (value) => value }),
  });
  try {
    const input = { value: 1 };
    const pending = server.client(t.event).echo(input);
    input.value = 2;
    gate.resolve(true);
    assert.deepEqual(await pending, { value: 1 });
  } finally {
    stop();
    detach();
  }
});
