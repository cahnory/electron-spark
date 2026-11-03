import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import { setImmediate } from "node:timers/promises";

mock.module("../src/main/core/security.ts", { namedExports: { configureSessionPermissions() {} } });

mock.module("../src/main/renderers.generated.ts", {
  defaultExport: {
    mode: "build",
    renderers: { view: { path: "/test/view/index.html", window: {} } },
  },
});

const windows: BrowserWindow[] = [];
class BrowserWindow extends EventEmitter {
  minimized = false;
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
  restore() {
    this.minimized = false;
  }
  isMinimized() {
    return this.minimized;
  }
  focus() {
    this.focused = true;
  }
  setIcon() {}
  async loadURL() {}
  async loadFile() {}
}
const app = Object.assign(new EventEmitter(), {
  quit: mock.fn(),
  requestSingleInstanceLock: () => true,
  whenReady: async () => {},
  setAppUserModelId() {},
  getName: () => "demo",
});
mock.module("electron", {
  namedExports: { app, session: { defaultSession: {} }, BrowserWindow, shell: {}, dialog: {} },
});
const provided: BrowserWindow[] = [];
mock.module("../src/main/settings.ts", {
  namedExports: {
    createSettings: async () => ({ provideTo: (window: BrowserWindow) => provided.push(window) }),
  },
});

void test("activation reopens a closed window and grants settings access", async () => {
  await import("../src/main/index.ts");
  await setImmediate();
  assert.equal(windows.length, 1);
  assert.ok(provided.includes(windows[0]));
  app.emit("activate");
  assert.equal(windows.length, 1);
  assert.equal(provided.length, 1);
  windows[0].destroyed = true;
  // Electron quits by default when no window-all-closed listener is registered.
  assert.ok(app.listenerCount("window-all-closed") > 0);
  app.emit("window-all-closed");
  assert.equal(app.quit.mock.callCount(), process.platform === "darwin" ? 0 : 1);
  app.emit("activate");
  assert.equal(windows.length, 2);
  assert.equal(provided.length, 2);
  await setImmediate();
  assert.ok(windows[1].focused);
  assert.ok(provided.includes(windows[1]));
});

void test("second instance restores and focuses the existing window", async () => {
  const window = windows.at(-1);
  assert.ok(window);
  window.minimized = true;
  window.focused = false;
  app.emit("second-instance");
  await setImmediate();
  assert.equal(window.minimized, false);
  assert.equal(window.focused, true);
  assert.equal(windows.length, 2);
});
