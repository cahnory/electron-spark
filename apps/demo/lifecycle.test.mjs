import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

const windows = [];
class BrowserWindow extends EventEmitter {
  destroyed = false;
  focused = false;
  webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
  constructor() {
    super();
    windows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return false;
  }
  focus() {
    this.focused = true;
  }
  async loadURL() {}
  async loadFile() {}
}
const app = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: () => true,
  whenReady: async () => {},
  setAppUserModelId() {},
  getName: () => "demo",
});
mock.module("electron", { namedExports: { app, BrowserWindow, shell: {} } });
const provided = new Set();
mock.module("./src/main/settings/index.ts", {
  namedExports: { createSettings: async () => ({ provideTo: (window) => provided.add(window) }) },
});

void test("activation reopens a closed window and grants settings access", async () => {
  await import("./src/main/index.ts");
  await setImmediate();
  assert.equal(windows.length, 1);
  assert.ok(provided.has(windows[0]));
  app.emit("activate");
  assert.equal(windows.length, 1);
  windows[0].destroyed = true;
  app.emit("activate");
  assert.equal(windows.length, 2);
  assert.ok(windows[1].focused);
  assert.ok(provided.has(windows[1]));
});
