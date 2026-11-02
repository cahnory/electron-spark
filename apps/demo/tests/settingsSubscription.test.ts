import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";

import type { Settings } from "../src/main/settings.ts";
import { subscribeSettings } from "../src/view/providers/settingsSubscription.ts";

void test("settings recover from initial and later failures and stop on disposal", async () => {
  let update!: (state: Settings) => void;
  let fail!: (error: unknown) => void;
  let attempts = 0;
  let unsubscribed = false;
  const values: string[] = [];
  const errors: unknown[] = [];
  const source: Parameters<typeof subscribeSettings>[0] = {
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
      const state: Settings = { locale: attempts === 2 ? "en" : "fr" };
      update(state);
      return state;
    },
  };
  const subscription = subscribeSettings(
    source,
    (state) => values.push(state.locale),
    (error) => errors.push(error),
    1,
  );
  fail(new Error("initial failure"));
  await setTimeout(30);
  assert.deepEqual(values, ["en"]);
  assert.equal(attempts, 2);
  fail(new Error("heartbeat failure"));
  await setTimeout(30);
  assert.deepEqual(values, ["en", "fr"]);
  fail(new Error("disconnected"));
  subscription.dispose();
  await setTimeout(10);
  assert.equal(attempts, 3);
  assert.equal(unsubscribed, true);
  assert.ok(errors.length);
});
