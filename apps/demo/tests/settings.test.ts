import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

import type { BrowserWindow } from "electron";

import type { Settings } from "../src/main/features/settings/settings.dto.ts";

type Reply = { ok: boolean; data: { data: Settings } };
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<Reply>>();
let userData: string;
const app = Object.assign(new EventEmitter(), { getPath: () => userData });
mock.module("electron", {
  namedExports: {
    app,
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<Reply>) =>
        handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  },
});
const { createSettings } = await import("../src/main/features/settings/settings.ipc.ts");

void test("settings IPC validates locale, persists changes, restricts callers, and reloads", async (context) => {
  userData = await mkdtemp(join(tmpdir(), "demo-settings-"));
  context.after(() => rm(userData, { recursive: true, force: true }));
  const frame = {
    url: "http://localhost:5173/view/index.html",
    send: (_channel: string, _snapshot: { data: Settings }) => {},
    parent: null,
    isDestroyed: () => false,
  };
  const sender = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  const window = { webContents: sender, isDestroyed: () => false };
  const service = await createSettings();
  context.after(service.dispose);
  assert.deepEqual(service.state.getState(), { locale: "en" });
  const call = handlers.get('ipc:["call","settings","setLocale"]');
  assert.ok(call);
  const event = { sender, senderFrame: frame };
  assert.equal((await call(event, { id: "unprovided", args: ["fr"] })).ok, false);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
  const revoke = service.provideTo(window as unknown as BrowserWindow, new URL(frame.url));
  assert.equal((await call(event, { id: "valid", args: ["fr"] })).ok, true);
  assert.deepEqual(service.state.getState(), { locale: "fr" });
  assert.deepEqual(JSON.parse(await readFile(join(userData, "settings.json"), "utf8")), {
    version: 1,
    data: { locale: "fr" },
  });
  assert.equal((await call(event, { id: "invalid", args: ["de"] })).ok, false);
  assert.equal(
    (await call({ sender, senderFrame: { ...frame } }, { id: "foreign", args: ["en"] })).ok,
    false,
  );
  assert.deepEqual(service.state.getState(), { locale: "fr" });
  const secondFrame = { ...frame };
  const secondSender = Object.assign(new EventEmitter(), {
    mainFrame: secondFrame,
    isDestroyed: () => false,
  });
  const secondWindow = { webContents: secondSender, isDestroyed: () => false };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
  service.provideTo(secondWindow as unknown as BrowserWindow, new URL(secondFrame.url));
  const secondEvent = { sender: secondSender, senderFrame: secondFrame };
  const subscribe = handlers.get('ipc:["state-subscribe","settings"]');
  assert.ok(subscribe);
  const updates: Settings[] = [];
  frame.send = (_channel, snapshot) => updates.push(snapshot.data);
  secondFrame.send = (_channel, snapshot) => updates.push(snapshot.data);
  assert.deepEqual((await subscribe(event, "first")).data.data, { locale: "fr" });
  assert.deepEqual((await subscribe(secondEvent, "second")).data.data, { locale: "fr" });
  assert.equal((await call(secondEvent, { id: "shared", args: ["en"] })).ok, true);
  assert.deepEqual(updates, [{ locale: "en" }, { locale: "en" }]);
  revoke();
  assert.equal((await call(event, { id: "revoked", args: ["fr"] })).ok, false);
  assert.equal((await call(secondEvent, { id: "remaining", args: ["fr"] })).ok, true);
  service.dispose();
  assert.equal(handlers.size, 0);
  const restarted = await createSettings();
  context.after(restarted.dispose);
  assert.deepEqual(restarted.state.getState(), { locale: "fr" });
  assert.equal(app.listenerCount("will-quit"), 1);
  app.emit("will-quit");
  assert.equal(handlers.size, 0);
  assert.equal(app.listenerCount("will-quit"), 0);
  assert.throws(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
    () => restarted.provideTo(window as unknown as BrowserWindow, new URL(frame.url)),
    /disposed/,
  );
});

void test("settings rejects unsupported versions, invalid data, and unversioned files", async (context) => {
  userData = await mkdtemp(join(tmpdir(), "demo-settings-version-"));
  context.after(() => rm(userData, { recursive: true, force: true }));
  const file = join(userData, "settings.json");
  await [
    { version: 2, data: { locale: "en" } },
    { version: 1, data: { locale: "de" } },
    { locale: "en" },
  ].reduce(async (previous, stored) => {
    await previous;
    const contents = JSON.stringify(stored);
    await writeFile(file, contents);
    await assert.rejects(createSettings());
    assert.equal(await readFile(file, "utf8"), contents);
    assert.equal(handlers.size, 0);
    assert.equal(app.listenerCount("will-quit"), 0);
  }, Promise.resolve());
});
