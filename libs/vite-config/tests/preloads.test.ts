import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";

import { createBuilder, createLogger, createServer } from "vite";

import { buildOnServe } from "../../vite-plugin-build-on-serve/src/index.ts";
import { defineElectronConfig } from "../src/index.ts";

async function fixture(t: TestContext) {
  const projectDir = await mkdtemp(path.join(tmpdir(), "electron-view-preloads-"));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  const files: Record<string, string> = {
    "package.json": '{"type":"module"}',
    "src/main/index.ts": 'export { default } from "./renderers.generated";',
    "src/preload/alpha.ts": `import { shared } from '../shared'; globalThis.alphaRuns = (globalThis.alphaRuns ?? 0) + 1; export const value = 'alpha'; export { shared };`,
    "src/preload/beta.ts": `import { shared } from '../shared'; export const value = 'beta'; export { shared };`,
    "src/preload/lazy.ts": `export const value = 'lazy';`,
    "src/preload/side-effect.ts": `globalThis.sideEffect = true;`,
    "src/preload/unused.ts": `throw new Error('unused preload executed'); export const value = 'unused';`,
    "src/shared.ts": `globalThis.sharedRuns = (globalThis.sharedRuns ?? 0) + 1; export const shared = 'preload-implementation-marker';`,
    "src/barrel.ts": `export { value } from '@preload/alpha';`,
    "src/views/first/index.html": '<html><script type="module" src="./index.ts"></script></html>',
    "src/views/first/index.ts": `import { value } from '../../barrel'; import { value as beta } from '@preload/beta'; import { value as again } from '../../preload/alpha'; import '../../preload/side-effect'; import type { value as unused } from '../../preload/unused'; globalThis.values = [value, beta, again]; globalThis.load = () => import('./lazy');`,
    "src/views/first/lazy.ts": `export { value } from '../../preload/lazy';`,
    "src/views/second/index.html": '<html><script type="module" src="./index.ts"></script></html>',
    "src/views/second/index.ts": `import { value } from '@preload/beta'; globalThis.value = value;`,
    "src/views/empty/index.html": "<html></html>",
  };
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      const target = path.join(projectDir, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  const config = defineElectronConfig({
    projectDir,
    vite: {
      logLevel: "silent",
      resolve: { alias: { "@preload": path.join(projectDir, "src/preload") } },
    },
  })({ command: "build", mode: "production" });
  return { projectDir, config: { ...config, configFile: false as const } };
}

function execute(code: string, isolated = true) {
  const exposeKey = "__APP_BRIDGE_EXPOSED__";
  const view: Record<string, unknown> & {
    [exposeKey]?: Record<string, { value: string; shared?: string }>;
  } = {};
  const sandbox: Record<string, unknown> = isolated ? {} : view;
  let exposures = 0;
  Object.assign(sandbox, {
    process: { contextIsolated: isolated },
    require(id: string) {
      assert.equal(id, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(key: string, value: unknown) {
            exposures++;
            assert.equal(exposures, 1, "Expose the complete registry exactly once");
            Object.defineProperty(view, key, { value: Object.freeze(value), writable: false });
          },
        },
      };
    },
  });
  vm.runInNewContext(code, sandbox);
  assert.ok(view[exposeKey]);
  return { sandbox, preloads: view[exposeKey] };
}

void test("builds one isolated aggregate per view, including aliases, barrels, lazy and side-effect imports", async (t) => {
  const { projectDir, config } = await fixture(t);
  const builder = await createBuilder(config);
  await builder.buildApp();
  const first = await readFile(path.join(projectDir, "dist/preload/views/first/index.cjs"), "utf8");
  for (const isolated of [true, false]) {
    const { sandbox, preloads } = execute(first, isolated);
    assert.deepEqual(Object.keys(preloads).toSorted(), [
      "preload/alpha.ts",
      "preload/beta.ts",
      "preload/lazy.ts",
      "preload/side-effect.ts",
    ]);
    assert.equal(preloads["preload/alpha.ts"].value, "alpha");
    assert.equal(preloads["preload/beta.ts"].value, "beta");
    assert.equal(preloads["preload/lazy.ts"].value, "lazy");
    assert.equal(sandbox.sharedRuns, 1);
    assert.equal(sandbox.alphaRuns, 1);
    assert.equal(sandbox.sideEffect, true);
  }
  const second = execute(
    await readFile(path.join(projectDir, "dist/preload/views/second/index.cjs"), "utf8"),
  );
  assert.deepEqual(Object.keys(second.preloads), ["preload/beta.ts"]);
  const empty = execute(
    await readFile(path.join(projectDir, "dist/preload/views/empty/index.cjs"), "utf8"),
  );
  assert.deepEqual(Object.keys(empty.preloads), []);
  const renderer = await builder.build(builder.environments.client);
  assert.ok(!Array.isArray(renderer) && "output" in renderer);
  for (const chunk of renderer.output) {
    if (chunk.type === "chunk")
      assert.doesNotMatch(
        chunk.code,
        /preload-implementation-marker|alphaRuns|sideEffect|unused preload executed/,
      );
  }
  const main = await readFile(path.join(projectDir, "dist/main/index.js"), "utf8");
  assert.match(main, /preload\/views\/first\/index.cjs/);
});

void test(
  "dev prepares preloads before the manifest and rebuilds after imports are added and removed",
  { timeout: 20000 },
  async (t) => {
    const { projectDir, config } = await fixture(t);
    // Exercise the build lifecycle without launching Electron or binding a port.
    config.plugins = config
      .plugins!.flat()
      .filter(
        (plugin) =>
          !plugin ||
          !("name" in plugin) ||
          plugin.name !== "@electron-spark/vite-plugin-build-on-serve:electron",
      );
    let reloads = 0;
    const errors: string[] = [];
    const server = await createServer({
      ...config,
      server: { ws: false },
      customLogger: {
        ...createLogger("silent"),
        error(message) {
          errors.push(message);
        },
      },
    });
    t.after(() => server.close());
    server.ws.send = (message: import("vite").HotPayload | string) => {
      if (typeof message !== "string" && message.type === "full-reload") reloads++;
    };
    server.httpServer!.address = () => ({ port: 4321, address: "127.0.0.1", family: "IPv4" });
    server.resolvedUrls = { local: ["http://localhost:4321/"], network: [] };
    await Promise.all(
      Object.values(server.environments).map((environment) => environment.listen(server)),
    );
    server.httpServer!.emit("listening");
    const output = path.join(projectDir, "dist/preload/views/second/index.cjs");
    const manifest = path.join(projectDir, "src/main/renderers.generated.ts");
    await waitFor(async () => {
      await readFile(manifest);
      return reloads >= 3;
    }, errors);
    // Discovery must not depend on generateBundle or write renderer assets.
    await assert.rejects(readFile(path.join(projectDir, "dist/views/first/index.html")), {
      code: "ENOENT",
    });
    assert.deepEqual(Object.keys(execute(await readFile(output, "utf8")).preloads), [
      "preload/beta.ts",
    ]);
    const initial = reloads;
    await writeFile(
      path.join(projectDir, "src/views/second/index.ts"),
      `import { value } from '@preload/alpha'; import '../../preload/beta'; globalThis.value = value;`,
    );
    await waitFor(
      async () =>
        reloads > initial &&
        Object.hasOwn(execute(await readFile(output, "utf8")).preloads, "preload/alpha.ts"),
      errors,
    );
    const beforeEdit = reloads;
    await writeFile(
      path.join(projectDir, "src/preload/alpha.ts"),
      `export const value = 'updated alpha';`,
    );
    await waitFor(
      async () =>
        reloads > beforeEdit &&
        execute(await readFile(output, "utf8")).preloads["preload/alpha.ts"]?.value ===
          "updated alpha",
      errors,
    );
    const added = reloads;
    await writeFile(
      path.join(projectDir, "src/views/second/index.ts"),
      `globalThis.value = 'no preloads';`,
    );
    await waitFor(
      async () =>
        reloads > added &&
        Object.keys(execute(await readFile(output, "utf8")).preloads).length === 0,
      errors,
    );
    assert.deepEqual(errors, []);
  },
);

void test(
  "cold dev startup succeeds in a fresh process without a prior production build",
  { timeout: 20000 },
  async () => {
    const env = { ...process.env };
    delete env.NODE_ENV;
    // Launch an independent test runner, not another child of this runner.
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-reporter=spec",
        "--test-name-pattern=^dev prepares",
        fileURLToPath(import.meta.url),
      ],
      { env, timeout: 15000 },
    );
    assert.match(stdout, /pass 1/);
  },
);

void test(
  "live dev server builds main from a clean start, recovers errors, and restarts its watchers",
  { timeout: 20000 },
  async (t) => {
    const { projectDir, config } = await fixture(t);
    config.plugins = config
      .plugins!.flat()
      .filter(
        (plugin) =>
          !plugin ||
          !("name" in plugin) ||
          plugin.name !== "@electron-spark/vite-plugin-build-on-serve:electron",
      );
    // Keep the real watched main build; only omit launching an Electron GUI.
    config.plugins.push(buildOnServe("electron"));
    const errors: string[] = [];
    let mainWrites = 0;
    let preloadWrites = 0;
    const closedWatchers: string[] = [];
    const output = path.join(projectDir, "dist/preload/views/second/index.cjs");
    const entry = path.join(projectDir, "src/views/second/index.ts");
    const server = await createServer({
      ...config,
      server: { host: "127.0.0.1", port: 0, ws: false },
      customLogger: {
        ...createLogger("silent"),
        error(message) {
          errors.push(message);
        },
      },
      plugins: [
        ...config.plugins,
        {
          name: "verify-startup-order",
          apply: "build",
          closeWatcher() {
            closedWatchers.push(this.environment.name);
          },
          async buildStart() {
            if (this.environment.name !== "electron") return;
            // A real main build must never begin before every view preload exists.
            await Promise.all(
              ["empty", "first", "second"].map((view) =>
                readFile(path.join(projectDir, `dist/preload/views/${view}/index.cjs`)),
              ),
            );
          },
          writeBundle() {
            if (this.environment.name === "electron") mainWrites++;
            if (this.environment.name.startsWith("preload")) preloadWrites++;
          },
        },
      ],
    });
    t.after(() => server.close());
    await server.listen();
    await waitFor(async () => mainWrites > 0, errors);
    assert.equal(preloadWrites, 3);
    assert.equal(execute(await readFile(output, "utf8")).preloads["preload/beta.ts"].value, "beta");
    const response = await fetch(new URL("views/second/index.html", server.resolvedUrls!.local[0]));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /index.ts/);
    assert.deepEqual(errors, []);

    const valid = await readFile(output, "utf8");
    await writeFile(entry, `import { value } from ;`);
    await waitFor(async () => errors.length > 0, errors);
    assert.equal(await readFile(output, "utf8"), valid);
    assert.match(errors.join("\n"), /index.ts/);
    await writeFile(
      entry,
      `import { value } from '../../preload/alpha'; globalThis.value = value;`,
    );
    await waitFor(
      async () =>
        Object.hasOwn(execute(await readFile(output, "utf8")).preloads, "preload/alpha.ts"),
      errors,
    );
    const assertExpectedErrors = () => {
      assert.ok(errors.length > 0);
      // The dev server and discovery watcher can report the same intentional
      // syntax error asynchronously. Validate every report instead of racing
      // their delivery by clearing the array after the first error.
      for (const message of errors) {
        assert.match(message, /Unexpected token/);
        assert.match(message, /index.ts/);
      }
    };
    assertExpectedErrors();

    const beforeRestart = mainWrites;
    await server.restart();
    assert.deepEqual(closedWatchers.toSorted(), [
      "client",
      "electron",
      "preload0",
      "preload1",
      "preload2",
    ]);
    await waitFor(async () => mainWrites > beforeRestart, errors);
    const beforeEdit = preloadWrites;
    await writeFile(
      path.join(projectDir, "src/preload/alpha.ts"),
      `export const value = 'after restart';`,
    );
    await waitFor(
      async () =>
        preloadWrites > beforeEdit &&
        execute(await readFile(output, "utf8")).preloads["preload/alpha.ts"]?.value ===
          "after restart",
      errors,
    );
    assertExpectedErrors();
    await server.close();
    assert.deepEqual(closedWatchers.toSorted(), [
      "client",
      "client",
      "electron",
      "electron",
      "preload0",
      "preload0",
      "preload1",
      "preload1",
      "preload2",
      "preload2",
    ]);
  },
);

void test("custom patterns select JavaScript preload modules and window declarations report migration guidance", async (t) => {
  const { projectDir } = await fixture(t);
  await mkdir(path.join(projectDir, "src/bridges"));
  await writeFile(
    path.join(projectDir, "src/bridges/api.js"),
    `export const value = 'custom pattern';`,
  );
  await writeFile(
    path.join(projectDir, "src/views/second/index.ts"),
    `import { value } from '../../bridges/api.js'; globalThis.value = value;`,
  );
  const config = defineElectronConfig({
    projectDir,
    viewPatterns: "views/second",
    preloadPatterns: ["bridges/**/*.js"],
  })({ command: "build", mode: "production" });
  const builder = await createBuilder({ ...config, configFile: false, logLevel: "silent" });
  await builder.buildApp();
  const output = execute(
    await readFile(path.join(projectDir, "dist/preload/views/second/index.cjs"), "utf8"),
  );
  assert.equal(output.preloads["bridges/api.js"].value, "custom pattern");
  await writeFile(
    path.join(projectDir, "src/views/second/window.json"),
    JSON.stringify({ webPreferences: { preload: "missing.ts" } }),
  );
  await assert.rejects(builder.buildApp(), /Remove webPreferences.preload.*preloadPatterns/);
});

void test("zero views need no renderer discovery build", async (t) => {
  const { projectDir } = await fixture(t);
  await writeFile(path.join(projectDir, "src/main/index.ts"), `export const main = true;`);
  const config = defineElectronConfig({ projectDir, viewPatterns: "no-views" })({
    command: "build",
    mode: "production",
  });
  const plugins = config.plugins!.flat();
  assert.ok(
    !plugins.some(
      (plugin) =>
        plugin &&
        "name" in plugin &&
        plugin.name === "@electron-spark/vite-plugin-build-on-serve:client",
    ),
  );
  const builder = await createBuilder({ ...config, configFile: false, logLevel: "silent" });
  await builder.buildApp();
  assert.match(
    await readFile(path.join(projectDir, "src/main/renderers.generated.ts"), "utf8"),
    /"renderers": {}/,
  );
});

async function waitFor(check: () => Promise<boolean>, errors: string[]) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await check()) return;
    } catch {
      /* Wait for the initial output. */
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Preload build did not finish: ${errors.join("\n")}`);
}
