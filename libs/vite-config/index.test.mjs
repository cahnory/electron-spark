import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { defineElectronConfig } from "./src/index.ts";

const context = { command: "build", mode: "production" };

async function fixture(t) {
  const projectDir = await mkdtemp(path.join(tmpdir(), "electron-config-"));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await Promise.all(
    ["view", "views/settings", "views/shared"].map(async (name) => {
      const dir = path.join(projectDir, "src", name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), "<html></html>");
      await writeFile(path.join(dir, "preload.ts"), "export {};");
      await writeFile(
        path.join(dir, "window.json"),
        JSON.stringify({
          webPreferences: {
            preload: name === "views/shared" ? "../../view/preload.ts" : "./preload.ts",
          },
        }),
      );
    }),
  );
  return projectDir;
}

await test("merges named overrides while preserving discovery and nested defaults", async (t) => {
  const projectDir = await fixture(t);
  const plugin = { name: "custom" };
  const config = defineElectronConfig({
    projectDir,
    main: { build: { sourcemap: true } },
    renderer: { define: { APP_NAME: '"test"' } },
    preload: { build: { minify: false, rolldownOptions: { external: ["custom-external"] } } },
    vite: { server: { port: 5173 }, plugins: [plugin] },
  })(context);
  assert.equal(config.base, "./");
  assert.equal(config.server.port, 5173);
  assert.ok(config.plugins.includes(plugin));
  assert.ok(config.plugins.length > 1);
  assert.equal(config.environments.electron.input, "main/index.ts");
  assert.equal(config.environments.electron.build.ssr, true);
  assert.equal(config.environments.electron.build.sourcemap, true);
  assert.equal(config.environments.client.input.length, 3);
  assert.equal(config.environments.client.define.APP_NAME, '"test"');
  const preloads = Object.entries(config.environments).filter(([name]) =>
    name.startsWith("preload"),
  );
  assert.equal(preloads.length, 2);
  for (const [, preload] of preloads) {
    assert.equal(preload.build.minify, false);
    assert.equal(preload.build.emptyOutDir, false);
    assert.equal(preload.build.rolldownOptions.output.format, "cjs");
    assert.ok(preload.build.rolldownOptions.external.includes("electron"));
    assert.ok(preload.build.rolldownOptions.external.includes("custom-external"));
  }
});

await test("callbacks mutate, replace and delete defaults, with root customization last", async (t) => {
  const projectDir = await fixture(t);
  const entries = [];
  const factory = defineElectronConfig({
    projectDir,
    main(config, env) {
      assert.equal(env.mode, "production");
      config.build.sourcemap = true;
      delete config.build.emptyOutDir;
    },
    renderer(config) {
      config.input = ["replacement.html"];
    },
    preload(config, { entry, command }) {
      assert.equal(command, "build");
      entries.push(entry);
      config.build.minify = entry.startsWith("view/");
      config.build.rolldownOptions.external = ["electron"];
    },
    vite(config) {
      assert.equal(config.environments.electron.build.sourcemap, true);
      config.environments.electron.build.sourcemap = false;
    },
  });
  const config = factory(context);
  assert.equal(config.environments.electron.build.sourcemap, false);
  assert.equal("emptyOutDir" in config.environments.electron.build, false);
  assert.deepEqual(config.environments.client.input, ["replacement.html"]);
  assert.deepEqual(
    entries.toSorted((a, b) => a.localeCompare(b)),
    ["view/preload.ts", "views/settings/preload.ts"],
  );
  assert.equal(config.environments.preload0.build.minify, true);
  assert.equal(config.environments.preload1.build.minify, false);
  assert.deepEqual(config.environments.preload0.build.rolldownOptions.external, ["electron"]);
  config.environments.preload0.build.rolldownOptions.external.push("leak");
  assert.deepEqual(factory(context).environments.preload0.build.rolldownOptions.external, [
    "electron",
  ]);
});

await test("discovers entries when evaluated rather than when declared", async (t) => {
  const projectDir = await fixture(t);
  const factory = defineElectronConfig({ projectDir });
  await mkdir(path.join(projectDir, "src/views/new"));
  await writeFile(path.join(projectDir, "src/views/new/index.html"), "<html></html>");
  assert.equal(factory(context).environments.client.input.length, 4);
});
