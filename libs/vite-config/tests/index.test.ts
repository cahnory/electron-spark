import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { createBuilder } from "vite";

import { defineElectronConfig } from "../src/index.ts";

const context = { command: "build" as const, mode: "production" };

async function fixture(t: TestContext) {
  const projectDir = await mkdtemp(path.join(tmpdir(), "electron-config-"));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await Promise.all(
    ["view", "views/settings", "views/shared"].map(async (name) => {
      const dir = path.join(projectDir, "src", name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "index.html"), "<html></html>");
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
  assert.equal(config.server!.port, 5173);
  assert.ok(config.plugins!.includes(plugin));
  assert.ok(config.plugins!.length > 1);
  assert.equal(config.environments!.electron.input, "main/index.ts");
  assert.equal(config.environments!.electron.build!.ssr, true);
  assert.equal(config.environments!.electron.build!.sourcemap, true);
  assert.ok(Array.isArray(config.environments!.client.input));
  assert.equal(config.environments!.client.input.length, 3);
  assert.equal(config.environments!.client.define!.APP_NAME, '"test"');
  const preloads = Object.entries(config.environments!).filter(([name]) =>
    name.startsWith("preload"),
  );
  assert.equal(preloads.length, 3);
  for (const [, preload] of preloads) {
    assert.equal(preload.build!.minify, false);
    assert.equal(preload.build!.emptyOutDir, false);
    const output = preload.build!.rolldownOptions!.output;
    assert.ok(output && !Array.isArray(output));
    assert.equal(output.format, "cjs");
    assert.ok(Array.isArray(preload.build!.rolldownOptions!.external));
    assert.ok(preload.build!.rolldownOptions!.external.includes("electron"));
    assert.ok(preload.build!.rolldownOptions!.external.includes("custom-external"));
  }
});

await test("callbacks mutate, replace and delete defaults, with root customization last", async (t) => {
  const projectDir = await fixture(t);
  const entries: string[] = [];
  const factory = defineElectronConfig({
    projectDir,
    main(config, env) {
      assert.equal(env.mode, "production");
      config.build!.sourcemap = true;
      delete config.build!.emptyOutDir;
    },
    renderer(config) {
      config.input = ["replacement.html"];
    },
    preload(config, { view, command }) {
      assert.equal(command, "build");
      entries.push(view);
      config.build!.minify = view === "view";
      config.build!.rolldownOptions!.external = ["electron"];
    },
    vite(config) {
      assert.equal(config.environments!.electron.build!.sourcemap, true);
      config.environments!.electron.build!.sourcemap = false;
    },
  });
  const config = factory(context);
  assert.equal(config.environments!.electron.build!.sourcemap, false);
  assert.equal("emptyOutDir" in config.environments!.electron.build!, false);
  assert.deepEqual(config.environments!.client.input, ["replacement.html"]);
  assert.deepEqual(
    entries.toSorted((a, b) => a.localeCompare(b)),
    ["view", "views/settings", "views/shared"],
  );
  assert.equal(config.environments!.preload0.build!.minify, true);
  assert.equal(config.environments!.preload1.build!.minify, false);
  assert.deepEqual(config.environments!.preload0.build!.rolldownOptions!.external, ["electron"]);
  const external = config.environments!.preload0.build!.rolldownOptions!.external;
  assert.ok(Array.isArray(external));
  external.push("leak");
  assert.deepEqual(factory(context).environments!.preload0.build!.rolldownOptions!.external, [
    "electron",
  ]);
});

await test("discovers entries when evaluated rather than when declared", async (t) => {
  const projectDir = await fixture(t);
  const factory = defineElectronConfig({ projectDir });
  await mkdir(path.join(projectDir, "src/views/new"));
  await writeFile(path.join(projectDir, "src/views/new/index.html"), "<html></html>");
  const input = factory(context).environments!.client.input;
  assert.ok(Array.isArray(input));
  assert.equal(input.length, 4);
});

await test("emits nested resources unchanged only in the main output", async (t) => {
  const projectDir = await fixture(t);
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(path.join(projectDir, "src/main/index.ts"), "export const main = true;");
  await mkdir(path.join(projectDir, "src/resources/data"), { recursive: true });
  const content = Buffer.from([0, 1, 127, 128, 255]);
  await writeFile(path.join(projectDir, "src/resources/data/example.bin"), content);
  const config = defineElectronConfig({ projectDir })(context);
  const builder = await createBuilder({
    ...config,
    configFile: false as const,
    logLevel: "silent",
  });
  await builder.build(builder.environments.electron);
  assert.deepEqual(
    await readFile(path.join(projectDir, "dist/main/resources/data/example.bin")),
    content,
  );
  assert.ok(config.server!.fs!.deny);
  assert.ok(config.server!.fs!.deny.includes("**/resources/**"));
});

await test("rejects resources directory symlinks, including dangling links", async (t) => {
  const projectDir = await fixture(t);
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(path.join(projectDir, "src/main/index.ts"), "export const main = true;");
  const target = path.join(projectDir, "external-resources");
  await mkdir(target);
  await writeFile(path.join(target, "private.bin"), "private");
  const resources = path.join(projectDir, "src/resources");
  await symlink(target, resources, "junction");
  const config = defineElectronConfig({ projectDir })(context);
  const builder = await createBuilder({
    ...config,
    configFile: false as const,
    logLevel: "silent",
  });
  await assert.rejects(
    builder.build(builder.environments.electron),
    /Resource symlinks are unsupported/,
  );
  await rm(target, { recursive: true });
  const danglingBuilder = await createBuilder({
    ...config,
    configFile: false as const,
    logLevel: "silent",
  });
  await assert.rejects(
    danglingBuilder.build(danglingBuilder.environments.electron),
    /Resource symlinks are unsupported/,
  );
});

await test("main defaults preserve runtime package paths and shim bundled CommonJS", async (t) => {
  const projectDir = await fixture(t);
  const driverDir = path.join(projectDir, "node_modules/test-driver");
  await mkdir(driverDir, { recursive: true });
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ type: "module", dependencies: { "test-driver": "1.0.0" } }),
  );
  await writeFile(
    path.join(driverDir, "package.json"),
    JSON.stringify({ name: "test-driver", exports: { "./binding": "./index.cjs" } }),
  );
  await writeFile(
    path.join(driverDir, "index.cjs"),
    `module.exports = require('node:fs').readFileSync(require('node:path').join(__dirname, 'binding.txt'), 'utf8');`,
  );
  await writeFile(path.join(driverDir, "binding.txt"), "package-relative binding");
  await writeFile(
    path.join(projectDir, "src/main/helper.cjs"),
    `module.exports = { directory: __dirname, filename: __filename, separator: require('node:path').sep };`,
  );
  await writeFile(
    path.join(projectDir, "src/main/index.ts"),
    `import driver from 'test-driver/binding'; import helper from './helper.cjs'; export { driver, helper };`,
  );
  const builder = await createBuilder({
    ...defineElectronConfig({ projectDir })(context),
    configFile: false,
    logLevel: "silent",
  });
  await builder.build(builder.environments.electron);
  const { pathToFileURL } = await import("node:url");
  const { realpath } = await import("node:fs/promises");
  const filename = await realpath(path.join(projectDir, "dist/main/index.js"));
  const result = await import(pathToFileURL(filename).href);
  assert.equal(result.driver, "package-relative binding");
  assert.equal(result.helper.directory, path.dirname(filename));
  assert.equal(result.helper.filename, filename);
  assert.equal(result.helper.separator, path.sep);
});

await test("main compatibility plugins can be disabled", async (t) => {
  const projectDir = await fixture(t);
  await writeFile(path.join(projectDir, "package.json"), '{"type":"module"}');
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(path.join(projectDir, "src/main/index.ts"), "console.log(__dirname);");
  const config = defineElectronConfig({ projectDir, externalDeps: false, esmShim: false })(context);
  const builder = await createBuilder({ ...config, configFile: false, logLevel: "silent" });
  await builder.build(builder.environments.electron);
  const code = await readFile(path.join(projectDir, "dist/main/index.js"), "utf8");
  assert.doesNotMatch(code, /createRequire|fileURLToPath/);
  assert.match(code, /__dirname/);
});

await test("runtime dependencies are external in main and bundled in views and preloads", async (t) => {
  const projectDir = await fixture(t);
  const dependencyDir = path.join(projectDir, "node_modules/runtime");
  await mkdir(dependencyDir, { recursive: true });
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ type: "module", dependencies: { runtime: "1" } }),
  );
  await writeFile(
    path.join(dependencyDir, "package.json"),
    JSON.stringify({ name: "runtime", type: "module", exports: "./index.js" }),
  );
  await writeFile(
    path.join(dependencyDir, "index.js"),
    `export const value = 'runtime-dependency-marker';`,
  );
  const source = `import { value } from 'runtime'; console.log(value);`;
  await writeFile(path.join(projectDir, "src/main/index.ts"), source);
  await mkdir(path.join(projectDir, "src/preload"));
  await writeFile(path.join(projectDir, "src/preload/runtime.ts"), source);
  await writeFile(
    path.join(projectDir, "src/view/index.ts"),
    `import "../preload/runtime"; ${source}`,
  );
  await writeFile(
    path.join(projectDir, "src/view/index.html"),
    '<html><script type="module" src="./index.ts"></script></html>',
  );
  const builder = await createBuilder({
    ...defineElectronConfig({ projectDir })(context),
    configFile: false,
    logLevel: "silent",
  });
  await builder.build(builder.environments.client);
  await builder.build(builder.environments.electron);
  await builder.build(builder.environments.preload0);
  const main = await readFile(path.join(projectDir, "dist/main/index.js"), "utf8");
  assert.match(main, /from ["']runtime["']/);
  assert.doesNotMatch(main, /runtime-dependency-marker/);
  await rm(path.join(projectDir, "node_modules"), { recursive: true });
  const preload = await readFile(path.join(projectDir, "dist/preload/view/index.cjs"), "utf8");
  const assetsDir = path.join(projectDir, "dist/assets");
  const renderer = (
    await Promise.all(
      (await readdir(assetsDir))
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(path.join(assetsDir, name), "utf8")),
    )
  ).join("\n");
  for (const output of [preload, renderer]) {
    assert.match(output, /runtime-dependency-marker/);
    assert.doesNotMatch(output, /(?:from\s*|require\s*\(\s*)["']runtime["']/);
  }
});

await test("bundled main dependencies run without node_modules", async (t) => {
  const projectDir = await fixture(t);
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ type: "module", dependencies: { runtime: "1" } }),
  );
  await Promise.all(
    ["runtime", "transitive"].map(async (name) => {
      const dir = path.join(projectDir, "node_modules", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name, type: "module", exports: { "./value": "./index.js" } }),
      );
      await writeFile(
        path.join(dir, "index.js"),
        name === "runtime"
          ? `export { value } from 'transitive/value';`
          : `export const value = 'bundled dependency';`,
      );
    }),
  );
  await mkdir(path.join(projectDir, "src/main"));
  await writeFile(
    path.join(projectDir, "src/main/index.ts"),
    `export { value } from 'runtime/value'; export const directory = __dirname;`,
  );
  const builder = await createBuilder({
    ...defineElectronConfig({ projectDir, externalDeps: false })(context),
    configFile: false,
    logLevel: "silent",
  });
  await builder.build(builder.environments.electron);
  await rm(path.join(projectDir, "node_modules"), { recursive: true });
  const { pathToFileURL } = await import("node:url");
  const { realpath } = await import("node:fs/promises");
  const filename = await realpath(path.join(projectDir, "dist/main/index.js"));
  const result = await import(pathToFileURL(filename).href);
  assert.equal(result.value, "bundled dependency");
  assert.equal(result.directory, path.dirname(filename));
});
