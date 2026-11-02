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

const errors: { title: string; message: string }[] = [];
const exits: number[] = [];
let startupError: Error;
const app = Object.assign(new EventEmitter(), {
  requestSingleInstanceLock: () => true,
  whenReady: async () => {},
  setAppUserModelId() {},
  getName: () => "demo",
  getPath: () => "/test/userData",
  exit: (code: number) => exits.push(code),
});
mock.module("electron", {
  namedExports: {
    app,
    session: { defaultSession: {} },
    BrowserWindow: function () {
      assert.fail("Startup failure must not create a window");
    },
    shell: {},
    dialog: {
      showErrorBox: (title: string, message: string) => {
        errors.push({ title, message });
      },
    },
  },
});
mock.module("../src/main/settings.ts", {
  namedExports: {
    createSettings: async () => {
      throw startupError;
    },
  },
});

for (const [index, error] of [
  new SyntaxError("Malformed settings JSON"),
  new Error("Unsupported storage version"),
  new Error("EACCES: permission denied"),
].entries()) {
  void test(`startup shows recovery instructions and exits: ${error.message}`, async () => {
    const log = mock.method(console, "error", () => {});
    try {
      startupError = error;
      await import(`../src/main/index.ts?failure=${index}`);
      await setImmediate();
      assert.equal(errors[index].title, "Unable to start");
      assert.ok(errors[index].message.includes(error.message));
      assert.ok(errors[index].message.includes("/test/userData/settings.json"));
      assert.match(errors[index].message, /move that file aside/);
      assert.equal(exits[index], 1);
      assert.equal(app.listenerCount("activate"), 0);
      app.removeAllListeners();
    } finally {
      log.mock.restore();
    }
  });
}
