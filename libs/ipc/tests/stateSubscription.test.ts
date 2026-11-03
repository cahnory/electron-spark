import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate, setTimeout } from "node:timers/promises";

import type { IpcStateBridge } from "../src/renderer.ts";
import { createIpcStateBridge, subscribeIpcState } from "../src/renderer.ts";
import { getChannel } from "../src/transport.ts";

void test("shared state subscriptions join recovery without cancelling each other", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const response = Promise.withResolvers<unknown>();
  const source = createIpcStateBridge<number>(
    {
      async invoke(channel) {
        if (channel !== getChannel("state-subscribe", "shared"))
          return { ok: true, data: undefined };
        attempts++;
        if (attempts === 1) throw new Error("offline");
        return response.promise;
      },
      on() {},
      removeListener() {},
    },
    "shared",
  );
  const values: number[][] = [[], []];
  const subscriptions = values.map((updates) =>
    subscribeIpcState({ source, update: (state) => updates.push(state) }),
  );
  context.after(async () => {
    for (const subscription of subscriptions) subscription.dispose();
    await source.dispose();
  });
  await assert.rejects(source.ready(), /offline/);
  context.mock.timers.tick(1000);
  await setImmediate();
  context.mock.timers.tick(2000);
  await setImmediate();
  assert.equal(attempts, 2);
  response.resolve({ ok: true, data: { revision: 0, data: 42 } });
  await source.ready();
  await setImmediate();
  assert.deepEqual(values, [[42], [42]]);

  subscriptions[0].retry();
  await source.ready();
  await setImmediate();
  assert.equal(attempts, 3);
  assert.deepEqual(values, [
    [42, 42],
    [42, 42],
  ]);
});

for (const throws of [false, true]) {
  void test(`IPC state retries with ${throws ? "throwing" : "omitted"} error reporting`, async () => {
    let fail!: (error: unknown) => void;
    let attempts = 0;
    const recovered = Promise.withResolvers<number>();
    const source: IpcStateBridge<number> = {
      async ready() {
        return source.reconnect();
      },
      getState: () => attempts,
      getStatus: () => "connected",
      subscribeStatus: () => () => {},
      async dispose() {},
      subscribe(onUpdate, onError) {
        fail = onError;
        recovered.promise.then(onUpdate).catch(() => {});
        return () => {};
      },
      async reconnect() {
        attempts++;
        if (attempts === 1) throw new Error("offline");
        recovered.resolve(attempts);
        return attempts;
      },
    };
    const subscription = subscribeIpcState({
      source,
      update: () => {},
      ...(throws
        ? {
            onError: () => {
              throw new Error("reporter failed");
            },
          }
        : {}),
      retryMs: 1,
    });
    try {
      assert.doesNotThrow(() => fail(new Error("initial failure")));
      assert.equal(await recovered.promise, 2);
    } finally {
      subscription.dispose();
    }
  });
}

void test("IPC state recovers from initial and later failures and stops on disposal", async () => {
  let update!: (state: number) => void;
  let fail!: (error: unknown) => void;
  let attempts = 0;
  let unsubscribed = false;
  const values: number[] = [];
  const errors: unknown[] = [];
  const source: IpcStateBridge<number> = {
    async ready() {
      return source.reconnect();
    },
    getState: () => attempts,
    getStatus: () => "connected",
    subscribeStatus: () => () => {},
    async dispose() {},
    subscribe(onUpdate, onError) {
      update = onUpdate;
      fail = onError;
      return () => {
        unsubscribed = true;
      };
    },
    async reconnect() {
      attempts++;
      fail(new Error("reconnecting"));
      if (attempts === 1) throw new Error("offline");
      const state = attempts;
      update(state);
      return state;
    },
  };
  const subscription = subscribeIpcState({
    source,
    update: (state) => values.push(state),
    onError: (error) => errors.push(error),
    retryMs: 1,
  });
  fail(new Error("initial failure"));
  await setTimeout(30);
  assert.deepEqual(values, [2]);
  assert.equal(attempts, 2);
  fail(new Error("heartbeat failure"));
  await setTimeout(30);
  assert.deepEqual(values, [2, 3]);
  fail(new Error("disconnected"));
  subscription.dispose();
  await setTimeout(10);
  assert.equal(attempts, 3);
  assert.equal(unsubscribed, true);
  assert.ok(errors.length);
  const errorCount = errors.length;
  update(4);
  fail(new Error("late failure"));
  subscription.retry();
  assert.deepEqual(values, [2, 3]);
  assert.equal(errors.length, errorCount);
  assert.equal(attempts, 3);
});
