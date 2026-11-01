import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";

const opened = [];

class BrowserWindow extends EventEmitter {
  webContents = new EventEmitter();

  constructor() {
    super();
    this.webContents.setWindowOpenHandler = (handler) => {
      this.openWindow = handler;
    };
  }

  isDestroyed() {
    return false;
  }

  async loadURL(url) {
    assert.equal(this.webContents.listenerCount("will-navigate"), 1);
    assert.equal(this.webContents.listenerCount("will-redirect"), 1);
    assert.equal(typeof this.openWindow, "function");
    this.loaded = url;
  }

  async loadFile(file) {
    return this.loadURL(pathToFileURL(file).href);
  }
}

mock.module("electron", {
  namedExports: {
    BrowserWindow,
    shell: {
      openExternal: async (url) => {
        opened.push(url);
      },
    },
  },
});

const { createRenderer } = await import("./src/main/core/windowManager.ts");

for (const mode of ["serve", "build"]) {
  for (const externalLinks of [undefined, "open", "block"]) {
    void test(`${mode}: externalLinks=${externalLinks ?? "default"}`, () => {
      const entry =
        mode === "serve"
          ? { url: "http://localhost:5173/view/index.html" }
          : { path: "/tmp/demo app/#renderer/view/index.html" };
      const renderers = createRenderer({ mode, renderers: { view: { ...entry, window: {} } } });
      const win = renderers.create("view", { externalLinks }).create();
      const rendererUrl = mode === "serve" ? entry.url : pathToFileURL(entry.path).href;
      assert.equal(win.loaded, rendererUrl);

      const internal = [rendererUrl, `${rendererUrl}#/settings`, `${rendererUrl}?theme=dark#/home`];
      const external = [
        "https://example.com/docs",
        "http://example.com/",
        `${rendererUrl}.other`,
        new URL("other.html", rendererUrl).href,
        "http://localhost.evil.example:5173/view/index.html",
        "file:///tmp/another.html",
        "mailto:test@example.com",
        "javascript:alert(1)",
        "data:text/html,hello",
        "custom-app://open",
        "not a URL",
      ];

      for (const eventName of ["will-navigate", "will-redirect"]) {
        for (const url of [...internal, ...external]) {
          opened.length = 0;
          let prevented = false;
          win.webContents.emit(eventName, {
            url,
            preventDefault() {
              prevented = true;
            },
          });
          const isInternal = internal.includes(url);
          assert.equal(prevented, !isInternal, `${eventName}: ${url}`);
          const shouldOpen = !isInternal && externalLinks !== "block" && /^https?:/.test(url);
          assert.deepEqual(opened, shouldOpen ? [url] : [], `${eventName}: ${url}`);
        }
      }

      for (const url of [...internal, ...external]) {
        opened.length = 0;
        assert.deepEqual(win.openWindow({ url }), { action: "deny" });
        const shouldOpen =
          !internal.includes(url) && externalLinks !== "block" && /^https?:/.test(url);
        assert.deepEqual(opened, shouldOpen ? [url] : [], `window.open: ${url}`);
      }
    });
  }
}
