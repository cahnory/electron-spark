import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import { createBuilder, createServer } from "vite";

const { electronPreload, electronPreloadExpose, electronPreloadRenderer } = await import(
  process.env.PRELOAD_PLUGIN_ENTRY ?? "./src/index.ts"
);

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "preload-bridge-"));
  try {
    await writeFile(
      path.join(root, "preload.ts"),
      `
import { ipcRenderer } from 'electron';
globalThis.preloadRuns = (globalThis.preloadRuns ?? 0) + 1;
export type OnlyType = string;
export const { number, nested: [other] } = { number: 42, nested: [7] };
export function ping() { return ipcRenderer.sendSync('ping'); }
const alias = 'aliased'; export { alias as renamed };
export default 'default value';
export * from './shared.ts';
export * as namespace from './shared.ts';
`,
    );
    await writeFile(
      path.join(root, "shared.ts"),
      "export const shared = 'shared'; export type SharedType = number;",
    );
    await writeFile(
      path.join(root, "view.ts"),
      "import * as api from './preload'; globalThis.api = api;",
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function config(root) {
  return {
    configFile: false,
    root,
    logLevel: "silent",
    environments: {
      client: { input: "view.ts", build: { write: false, minify: false } },
      preload: {
        consumer: "server",
        input: "preload.ts",
        resolve: { noExternal: true },
        build: {
          ssr: true,
          write: false,
          rolldownOptions: {
            external: ["electron"],
            output: { format: "cjs", codeSplitting: false },
          },
        },
      },
    },
    plugins: electronPreload(),
  };
}

for (const composed of [false, true]) {
  for (const isolated of [false, true]) {
    test(`bridges all value exports, without renderer execution (isolated=${isolated}, composed=${composed})`, async () => {
      await fixture(async (root) => {
        const options = config(root);
        if (!composed) options.plugins = [electronPreloadExpose(), electronPreloadRenderer()];
        const builder = await createBuilder(options);
        const preload = await builder.build(builder.environments.preload);
        const renderer = await builder.build(builder.environments.client);
        const preloadCode = preload.output.find(
          (item) => item.type === "chunk" && item.isEntry,
        ).code;
        const rendererCode = renderer.output.find(
          (item) => item.type === "chunk" && item.isEntry,
        ).code;
        assert.doesNotMatch(rendererCode, /ipcRenderer|preloadRuns|OnlyType|SharedType/);
        const view = {};
        const sandbox = isolated ? {} : view;
        Object.assign(sandbox, {
          process: { contextIsolated: isolated },
          require: (id) => {
            assert.equal(id, "electron");
            return {
              contextBridge: {
                exposeInMainWorld: (key, value) => {
                  view[key] = value;
                },
              },
              ipcRenderer: { sendSync: () => "pong" },
            };
          },
        });
        vm.runInNewContext(preloadCode, sandbox);
        vm.runInNewContext(rendererCode, view);
        assert.equal(sandbox.preloadRuns, 1);
        assert.equal(view.api.number, 42);
        assert.equal(view.api.other, 7);
        assert.equal(view.api.ping(), "pong");
        assert.equal(view.api.renamed, "aliased");
        assert.equal(view.api.default, "default value");
        assert.equal(view.api.shared, "shared");
        assert.equal(view.api.namespace.shared, "shared");
        assert.throws(
          () => vm.runInNewContext(rendererCode, {}),
          /has not been loaded for this view/,
        );
      });
    });
  }
}

test("dev imports use the getter and watch re-exported files", async () => {
  await fixture(async (root) => {
    const server = await createServer({
      ...config(root),
      server: { middlewareMode: true, ws: false },
      plugins: [electronPreloadRenderer()],
    });
    try {
      const result = await server.environments.client.transformRequest("/preload.ts");
      assert.match(result.code, /getExposed/);
      assert.match(result.code, /shared/);
      assert.doesNotMatch(result.code, /ipcRenderer|preloadRuns/);
      await writeFile(path.join(root, "shared.ts"), "export const added = 1;");
      server.environments.client.moduleGraph.invalidateAll();
      const updated = await server.environments.client.transformRequest("/preload.ts");
      assert.match(updated.code, /added/);
    } finally {
      await server.close();
    }
  });
});

test("each preload environment exposes its own entry under a distinct key", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, "second.ts"), "export const second = 'second';");
    await writeFile(
      path.join(root, "view.ts"),
      "import { second } from './second'; globalThis.result = second;",
    );
    const options = config(root);
    options.environments.second = {
      ...options.environments.preload,
      input: { second: "second.ts" },
    };
    options.plugins.push(...electronPreload("second"));
    const builder = await createBuilder(options);
    const second = await builder.build(builder.environments.second);
    const renderer = await builder.build(builder.environments.client);
    const view = { process: { contextIsolated: false }, require: () => ({ contextBridge: {} }) };
    vm.runInNewContext(
      second.output.find((item) => item.type === "chunk" && item.isEntry).code,
      view,
    );
    vm.runInNewContext(
      renderer.output.find((item) => item.type === "chunk" && item.isEntry).code,
      view,
    );
    assert.equal(view.result, "second");
    assert.equal(view.__APP_BRIDGE_EXPOSED_PRELOADS__["second.ts"], true);
    assert.equal(view.__APP_BRIDGE_EXPOSED_PRELOADS__["preload.ts"], undefined);
  });
});
