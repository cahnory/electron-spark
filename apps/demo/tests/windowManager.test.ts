import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";

const opened: string[] = [];
let loadError: Error | undefined;
const windows: BrowserWindow[] = [];

class BrowserWindow extends EventEmitter {
  destroyed = false;
  loaded = "";
  openWindow: (details: { url: string }) => { action: "deny" } = () =>
    assert.fail("Window handler not installed");
  webContents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: (handler: BrowserWindow["openWindow"]) => {
      this.openWindow = handler;
    },
  });

  constructor() {
    super();
    windows.push(this);
  }

  isDestroyed() {
    return this.destroyed ?? false;
  }

  destroy() {
    this.destroyed = true;
  }

  async loadURL(url: string) {
    if (loadError) throw loadError;
    assert.equal(this.webContents.listenerCount("will-navigate"), 1);
    assert.equal(this.webContents.listenerCount("will-redirect"), 1);
    assert.equal(typeof this.openWindow, "function");
    this.loaded = url;
  }

  async loadFile(file: string) {
    return this.loadURL(pathToFileURL(file).href);
  }
}

mock.module("electron", {
  namedExports: {
    BrowserWindow,
    shell: {
      openExternal: async (url: string) => {
        opened.push(url);
      },
    },
  },
});

const { createRenderer } = await import("../src/main/core/windowManager.ts");

for (const mode of ["serve", "build"] as const) {
  for (const externalLinks of [undefined, "open", "block"] as const) {
    void test(`${mode}: externalLinks=${externalLinks ?? "default"}`, () => {
      const entry =
        mode === "serve"
          ? { url: "http://localhost:5173/view/index.html" }
          : { path: "/tmp/demo app/#renderer/view/index.html" };
      const renderers = createRenderer(
        mode === "serve"
          ? {
              mode,
              renderers: { view: { url: "http://localhost:5173/view/index.html", window: {} } },
            }
          : {
              mode,
              renderers: { view: { path: "/tmp/demo app/#renderer/view/index.html", window: {} } },
            },
      );
      const win = renderers.create("view", { externalLinks }).create();
      assert.ok(win instanceof BrowserWindow);
      const rendererUrl = "url" in entry ? entry.url : pathToFileURL(entry.path).href;
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

for (const mode of ["serve", "build"] as const) {
  void test(`${mode}: load failures reject readiness and retire the failed window`, async () => {
    const entry = { url: "http://localhost:5173/", path: "/missing/index.html", window: {} };
    const manager = createRenderer({
      ...(mode === "serve" ? { mode: "serve" as const } : { mode: "build" as const }),
      renderers: {
        view: entry,
      },
    }).create("view");
    loadError = new Error("Renderer unavailable");
    try {
      manager.create();
      await assert.rejects(manager.ready(), /Renderer unavailable/);
      assert.equal(windows.at(-1)!.destroyed, true);
      assert.equal(manager.has(), false);
    } finally {
      loadError = undefined;
    }
    manager.create();
    await manager.ready();
    assert.equal(manager.has(), true);
  });
}
