import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

import type { PluginOption, Plugin, Rolldown } from "vite";
import { createBuilder, createServer } from "vite";

import { EXPOSE_KEY } from "../src/runtime/common.ts";

const {
  electronPreload,
  electronPreloadExpose,
  electronPreloadRenderer,
}: typeof import("../src/index.ts") = await import(
  process.env.PRELOAD_PLUGIN_ENTRY ?? "../src/index.ts"
);

async function fixture(run: (root: string) => Promise<void>) {
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

function config(root: string) {
  return {
    configFile: false as const,
    root,
    logLevel: "silent" as const,
    environments: {
      client: { input: "view.ts", build: { write: false, minify: false } },
      preload: {
        consumer: "server" as const,
        input: "preload.ts",
        resolve: { noExternal: true as const },
        build: {
          outDir: "dist",
          ssr: true,
          write: false,
          rolldownOptions: {
            external: ["electron"],
            output: { format: "cjs" as const, codeSplitting: false },
          },
        },
      },
    },
    plugins: electronPreload() as PluginOption[],
  };
}

for (const composed of [false, true]) {
  for (const isolated of [false, true]) {
    void test(`bridges all value exports, without renderer execution (isolated=${isolated}, composed=${composed})`, async () => {
      await fixture(async (root) => {
        const options = config(root);
        if (!composed) options.plugins = [electronPreloadExpose(), electronPreloadRenderer()];
        const builder = await createBuilder(options);
        const preload = await builder.build(builder.environments.preload);
        assert.ok(!Array.isArray(preload) && "output" in preload);
        const renderer = await builder.build(builder.environments.client);
        assert.ok(!Array.isArray(renderer) && "output" in renderer);
        const preloadCode = preload.output.find(
          (item): item is Rolldown.OutputChunk => item.type === "chunk" && item.isEntry,
        )!.code;
        const rendererCode = renderer.output.find(
          (item): item is Rolldown.OutputChunk => item.type === "chunk" && item.isEntry,
        )!.code;
        assert.doesNotMatch(rendererCode, /ipcRenderer|preloadRuns|OnlyType|SharedType/);
        const view: {
          api?: {
            number: number;
            other: number;
            ping(): string;
            renamed: string;
            default: string;
            shared: string;
            namespace: { shared: string };
          };
          preloadRuns?: number;
          [key: string]: unknown;
        } = {};
        const sandbox: typeof view = isolated ? {} : view;
        Object.assign(sandbox, {
          process: { contextIsolated: isolated },
          require: (id: string) => {
            assert.equal(id, "electron");
            return {
              contextBridge: {
                exposeInMainWorld: (key: string, value: unknown) => {
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
        assert.equal(view.api!.number, 42);
        assert.equal(view.api!.other, 7);
        assert.equal(view.api!.ping(), "pong");
        assert.equal(view.api!.renamed, "aliased");
        assert.equal(view.api!.default, "default value");
        assert.equal(view.api!.shared, "shared");
        assert.equal(view.api!.namespace.shared, "shared");
        assert.throws(
          () => vm.runInNewContext(rendererCode, {}),
          /has not been loaded for this view/,
        );
      });
    });
  }
}

void test("dev imports use the getter and watch re-exported files", async () => {
  await fixture(async (root) => {
    const server = await createServer({
      ...config(root),
      server: { middlewareMode: true, ws: false },
      plugins: [electronPreloadRenderer()],
    });
    try {
      const result = await server.environments.client.transformRequest("/preload.ts");
      assert.ok(result);
      assert.match(result.code, /getExposed/);
      assert.ok(result);
      assert.match(result.code, /shared/);
      assert.doesNotMatch(result.code, /ipcRenderer|preloadRuns/);
      await writeFile(path.join(root, "shared.ts"), "export const added = 1;");
      server.environments.client.moduleGraph.invalidateAll();
      const updated = await server.environments.client.transformRequest("/preload.ts");
      assert.ok(updated);
      assert.match(updated.code, /added/);
    } finally {
      await server.close();
    }
  });
});

void test("each preload environment exposes its own entry under a distinct key", async () => {
  await fixture(async (root) => {
    await writeFile(path.join(root, "second.ts"), "export const second = 'second';");
    await writeFile(
      path.join(root, "view.ts"),
      "import { second } from './second'; globalThis.result = second;",
    );
    const options = config(root);
    Object.assign(options.environments, {
      second: {
        ...options.environments.preload,
        input: { second: "second.ts" },
      },
    });
    options.plugins.push(...electronPreload("second"));
    const builder = await createBuilder(options);
    const second = await builder.build(builder.environments.second);
    assert.ok(!Array.isArray(second) && "output" in second);
    const renderer = await builder.build(builder.environments.client);
    assert.ok(!Array.isArray(renderer) && "output" in renderer);
    const view: {
      result?: string;
      [EXPOSE_KEY]?: Record<string, Record<string, unknown>>;
    } & Record<string, unknown> = {
      process: { contextIsolated: false },
      require: () => ({ contextBridge: {} }),
    };
    vm.runInNewContext(
      second.output.find(
        (item): item is Rolldown.OutputChunk => item.type === "chunk" && item.isEntry,
      )!.code,
      view,
    );
    vm.runInNewContext(
      renderer.output.find(
        (item): item is Rolldown.OutputChunk => item.type === "chunk" && item.isEntry,
      )!.code,
      view,
    );
    assert.equal(view.result, "second");
    assert.ok(view[EXPOSE_KEY]);
    assert.equal(view[EXPOSE_KEY]["second.ts"].second, "second");
    assert.equal(view[EXPOSE_KEY]["preload.ts"], undefined);
  });
});

void test(
  "successful preload rebuilds reload renderers after writing the new bridge",
  { timeout: 10000 },
  async () => {
    await fixture(async (root) => {
      const options = config(root);
      options.environments.preload.build.write = true;
      options.environments.preload.build.outDir = path.join(root, "dist");
      const reloads: number[] = [];
      let written = 0;
      const probe: Plugin = {
        name: "observe-preload-output",
        writeBundle() {
          written++;
        },
        configureServer(server) {
          server.ws.send = (message: import("vite").HotPayload | string) => {
            if (typeof message !== "string" && message.type === "full-reload")
              reloads.push(written);
          };
        },
      };
      options.plugins.push(probe);
      const server = await createServer({ ...options, server: { ws: false } });
      server.httpServer!.address = () => ({ port: 4321, address: "127.0.0.1", family: "IPv4" });
      try {
        // Exercise the listening lifecycle without opening a port.
        await Promise.all(
          Object.values(server.environments).map((environment) => environment.listen(server)),
        );
        server.httpServer!.emit("listening");
        await waitFor(() => reloads.includes(1));
        await writeFile(path.join(root, "shared.ts"), "export const shared = 'updated';");
        await waitFor(() => reloads.includes(2));
      } finally {
        await server.close();
      }
    });
  },
);

async function waitFor(check: () => boolean, remaining = 100): Promise<void> {
  if (check()) return;
  if (!remaining) assert.fail("preload rebuild did not reload renderers");
  await new Promise((resolve) => setTimeout(resolve, 25));
  return waitFor(check, remaining - 1);
}
