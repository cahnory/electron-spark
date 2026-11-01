import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, cp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createBuilder, createServer } from "vite";

import { buildOnServe } from "../vite-plugin-build-on-serve/src/index.ts";
import { electronRenderer } from "./src/index.ts";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "renderer-metadata-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(`${root}/screens/settings`, { recursive: true });
  await mkdir(`${root}/panels/help`, { recursive: true });
  await writeFile(`${root}/panels/help/page.html`, "<html>Help</html>");
  await writeFile(`${root}/screens/settings/index.html`, "<html><body>Hello</body></html>");
  await writeFile(`${root}/screens/settings/bridge.js`, 'console.log("preload")');
  await writeFile(
    `${root}/main.js`,
    'import renderer from "./generated/renderer.ts"; console.log(JSON.stringify(renderer))',
  );
  await writeFile(
    `${root}/screens/settings/window.json`,
    JSON.stringify({ webPreferences: { preload: "./bridge.js" } }),
  );
  const options = {
    electronEnvironment: "electron",
    rendererManifestPath: "generated/renderer.ts",
  };
  return {
    root,
    options,
    config: {
      configFile: false,
      root,
      logLevel: "silent",
      base: "/app/",
      builder: {},
      environments: {
        // Main intentionally precedes the dependencies it imports.
        electron: {
          consumer: "server",
          input: "main.js",
          build: {
            ssr: true,
            outDir: "dist/main",
            rolldownOptions: { output: { entryFileNames: "main.js" } },
          },
        },
        client: {
          input: ["screens/settings/index.html", "panels/help/page.html"],
          build: { outDir: "dist/client" },
        },
        preload: {
          consumer: "server",
          input: "screens/settings/bridge.js",
          build: {
            ssr: true,
            outDir: "dist/preload",
            rolldownOptions: { output: { entryFileNames: "custom-[hash].cjs", format: "cjs" } },
          },
        },
      },
    },
  };
}
async function data(root) {
  return (
    await import(
      `${pathToFileURL(`${root}/generated/renderer.ts`).href}?version=${Date.now()}-${Math.random()}`
    )
  ).default;
}

async function checkRendererTypes(root) {
  await writeFile(`${root}/package.json`, JSON.stringify({ type: "module" }));
  await writeFile(
    `${root}/consumer.ts`,
    `import renderer from "./generated/renderer.ts";
if (renderer.mode === "serve") {
  const url: string = renderer.renderers["screens/settings"].url;
  // @ts-expect-error A development renderer has no file path.
  renderer.renderers["screens/settings"].path;
} else {
  const path: string = renderer.renderers["screens/settings"].path;
  // @ts-expect-error A production renderer has no URL.
  renderer.renderers["screens/settings"].url;
}
const preload: string = renderer.renderers["screens/settings"].window.webPreferences.preload;
// @ts-expect-error Renderer keys stay precise.
renderer.renderers.missing;
// @ts-expect-error Renderers without a preload keep their own window options.
renderer.renderers["panels/help"].window.webPreferences;
`,
  );
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url)),
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--module",
      "nodenext",
      "--target",
      "esnext",
      "--allowImportingTsExtensions",
      "--types",
      "node",
      "--typeRoots",
      fileURLToPath(new URL("../../node_modules/@types", import.meta.url)),
      `${root}/consumer.ts`,
    ],
    { cwd: root, encoding: "utf8" },
  );
}
async function until(fn) {
  let lastError;
  for (let i = 0; i < 200; i++) {
    try {
      if (await fn()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for generated renderer metadata", { cause: lastError });
}

void test("build collects emitted filenames before compiling main and discovers arbitrary renderer paths and optional preloads", async (t) => {
  const { root, options, config } = await fixture(t);
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  const result = await data(root);
  assert.equal(result.mode, "build");
  await checkRendererTypes(root);
  assert.equal("publicPath" in result, false);
  assert.equal(
    result.renderers["screens/settings"].path,
    `${root}/dist/client/screens/settings/index.html`,
  );
  assert.match(
    result.renderers["screens/settings"].window.webPreferences.preload,
    /\/dist\/preload\/custom-.*\.cjs$/,
  );
  assert.deepEqual(Object.keys(result.renderers), ["screens/settings", "panels/help"]);
  assert.equal(result.renderers["panels/help"].window.webPreferences, undefined);
  assert.match(await readFile(`${root}/dist/main/main.js`, "utf8"), /custom-/);
});

for (const fromFile of [false, true])
  void test(`serve preserves metadata across watched builds (${fromFile ? "config file" : "inline"})`, async (t) => {
    const { root, options, config } = await fixture(t);
    const plugins = [electronRenderer(options), buildOnServe("preload"), buildOnServe("electron")];
    if (fromFile) {
      await writeFile(
        `${root}/vite.config.mjs`,
        `
      import { electronRenderer } from ${JSON.stringify(new URL("./src/index.ts", import.meta.url).href)};
      import { buildOnServe } from ${JSON.stringify(new URL("../vite-plugin-build-on-serve/src/index.ts", import.meta.url).href)};
      export default { ...${JSON.stringify(config)}, plugins: [electronRenderer(${JSON.stringify(options)}), buildOnServe("preload"), buildOnServe("electron")] };
    `,
      );
    }
    const server = await createServer(
      fromFile
        ? { configFile: `${root}/vite.config.mjs`, server: { ws: false } }
        : { ...config, server: { ws: false }, plugins },
    );
    t.after(() => server.close());
    // Exercise the HTTP lifecycle without binding a sandboxed network port.
    server.resolvedUrls = { local: ["http://localhost:4321/app/"], network: [] };
    await Promise.all(
      Object.values(server.environments).map((environment) => environment.listen(server)),
    );
    server.httpServer.address = () => ({ port: 4321, address: "127.0.0.1", family: "IPv4" });
    server.httpServer.emit("listening");
    await until(async () => (await data(root)).mode === "serve");
    if (!fromFile) await checkRendererTypes(root);
    const result = await data(root);
    assert.equal("publicPath" in result, false);
    assert.equal(
      result.renderers["screens/settings"].url,
      "http://localhost:4321/app/screens/settings/index.html",
    );
    assert.match(
      result.renderers["screens/settings"].window.webPreferences.preload,
      /\/dist\/preload\/custom-.*\.cjs$/,
    );
    await until(async () =>
      (await readFile(`${root}/dist/main/main.js`, "utf8")).includes("http://localhost:4321"),
    );
    await writeFile(`${root}/screens/settings/bridge.js`, 'console.log("changed preload")');
    await until(
      async () =>
        (await data(root)).renderers["screens/settings"].window.webPreferences.preload !==
        result.renderers["screens/settings"].window.webPreferences.preload,
    );
    assert.equal((await data(root)).mode, "serve");
    await writeFile(
      `${root}/screens/settings/window.json`,
      JSON.stringify({
        title: "Live settings",
        autoHideMenuBar: true,
        webPreferences: { preload: "./bridge.js" },
      }),
    );
    await until(
      async () => (await data(root)).renderers["screens/settings"].window.title === "Live settings",
    );
    await writeFile(
      `${root}/screens/settings/window.json`,
      JSON.stringify({ webPreferences: { preload: "./bridge.js" } }),
    );
    await writeFile(`${root}/screens/settings/index.html`, "<title>Updated &amp; live</title>");
    await until(
      async () =>
        (await data(root)).renderers["screens/settings"].window.title === "Updated & live",
    );
  });

void test("skips an implicit SSR environment added by a plugin", async (t) => {
  const { root, options, config } = await fixture(t);
  const builder = await createBuilder({
    ...config,
    plugins: [
      electronRenderer(options),
      { name: "ssr-dependencies", config: () => ({ ssr: { external: ["example"] } }) },
    ],
  });
  assert.ok(builder.environments.ssr);
  await builder.buildApp();
  assert.match(await readFile(`${root}/dist/main/main.js`, "utf8"), /screens\/settings/);
});

void test("builds an explicit SSR entry", async (t) => {
  const { root, options, config } = await fixture(t);
  await writeFile(`${root}/worker.js`, 'console.log("explicit SSR entry")');
  config.environments.ssr = {
    input: "worker.js",
    build: {
      ssr: true,
      outDir: "dist/ssr",
      rolldownOptions: { output: { entryFileNames: "worker.js" } },
    },
  };
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  assert.match(await readFile(`${root}/dist/ssr/worker.js`, "utf8"), /explicit SSR entry/);
});

void test("discovers renamed client/server environments and object inputs", async (t) => {
  const { root, options, config } = await fixture(t);
  config.environments.windows = {
    ...config.environments.client,
    consumer: "client",
    input: undefined,
    build: {
      ...config.environments.client.build,
      rolldownOptions: {
        input: { settings: "screens/settings/index.html", help: "panels/help/page.html" },
      },
    },
  };
  config.environments.client = { input: "worker.js", build: { outDir: "dist/unused-client" } };
  config.environments.bridge = config.environments.preload;
  delete config.environments.preload;
  // An unrelated server environment is not a renderer preload.
  await writeFile(`${root}/worker.js`, 'console.log("worker")');
  config.environments.worker = {
    consumer: "server",
    input: "worker.js",
    build: { ssr: true, outDir: "dist/worker" },
  };
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  const result = await data(root);
  assert.deepEqual(Object.keys(result.renderers), ["screens/settings", "panels/help"]);
  assert.match(
    result.renderers["screens/settings"].window.webPreferences.preload,
    /\/dist\/preload\/custom-/,
  );
  assert.equal(result.renderers["panels/help"].path, `${root}/dist/client/panels/help/page.html`);
});

void test("discovers the default root HTML entry without a preload", async (t) => {
  const { root, options, config } = await fixture(t);
  await writeFile(`${root}/index.html`, "<html>Root</html>");
  delete config.environments.client.input;
  delete config.environments.preload;
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  assert.deepEqual((await data(root)).renderers, {
    ".": { path: `${root}/dist/client/index.html`, window: {} },
  });
});

void test("rejects multiple environments for the declared preload", async (t) => {
  const { options, config } = await fixture(t);
  config.environments.otherBridge = {
    ...config.environments.preload,
    input: "screens/settings/bridge.js",
  };
  await assert.rejects(
    createBuilder({ ...config, plugins: [electronRenderer(options)] }),
    /Ambiguous preload entries/,
  );
});

for (const format of ["es", "cjs"]) {
  void test(`runtime paths survive relocation and nested Electron output (${format})`, async (t) => {
    const { root, options, config } = await fixture(t);
    config.environments.electron.build.minify = true;
    const filename = format === "es" ? "nested/main.mjs" : "nested/main.cjs";
    config.environments.electron.build.rolldownOptions.output = {
      format,
      entryFileNames: filename,
    };
    await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
    const source = await readFile(`${root}/generated/renderer.ts`, "utf8");
    assert.ok(source.includes('resolve(dirname, "../dist/client/screens/settings/index.html")'));
    assert.ok(!source.includes(root));
    const output = await readFile(`${root}/dist/main/${filename}`, "utf8");
    assert.ok(!output.replace(/^\s*\/\/.*$/gm, "").includes(root));
    assert.ok(!output.includes("__electron_renderer_path:"));
    await cp(`${root}/dist`, `${root}/moved app`, { recursive: true });
    const result = JSON.parse(
      execFileSync(process.execPath, [`${root}/moved app/main/${filename}`], {
        cwd: tmpdir(),
        encoding: "utf8",
      }),
    );
    assert.equal("publicPath" in result, false);
    assert.equal(
      result.renderers["screens/settings"].path,
      `${root}/moved app/client/screens/settings/index.html`,
    );
    assert.equal(
      path.dirname(result.renderers["screens/settings"].window.webPreferences.preload),
      `${root}/moved app/preload`,
    );
    assert.match(await readFile(result.renderers["screens/settings"].path, "utf8"), /Hello/);
    await readFile(result.renderers["screens/settings"].window.webPreferences.preload);
  });
}

for (const filename of [undefined, "metadata/windows.ts"]) {
  void test(`generates relative to a nested Electron entry (${filename ?? "default"})`, async (t) => {
    const { root, config } = await fixture(t);
    await mkdir(`${root}/electron/main`, { recursive: true });
    const relativeFile = filename ?? "renderers.generated.ts";
    await writeFile(
      `${root}/electron/main/start.ts`,
      `import renderer from "./${relativeFile}"; console.log(JSON.stringify(renderer));`,
    );
    config.environments.electron.input = "ignored.js";
    config.environments.electron.build.rolldownOptions.input = { main: "electron/main/start.ts" };
    const options = {
      electronEnvironment: "electron",
      ...(filename ? { rendererManifestPath: filename } : {}),
    };
    await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
    const generated = `${root}/electron/main/${relativeFile}`;
    const renderer = (await import(pathToFileURL(generated).href)).default;
    assert.equal(
      renderer.renderers["screens/settings"].path,
      `${root}/dist/client/screens/settings/index.html`,
    );
    const built = JSON.parse(
      execFileSync(process.execPath, [`${root}/dist/main/main.js`], { encoding: "utf8" }),
    );
    assert.deepEqual(built, renderer);
  });
}

void test("rejects missing or ambiguous Electron inputs", async (t) => {
  const { config } = await fixture(t);
  for (const input of [[], ["main.js", "other.js"]]) {
    config.environments.electron.input = input;
    await assert.rejects(
      createBuilder({
        ...config,
        plugins: [electronRenderer({ electronEnvironment: "electron" })],
      }),
      /must have exactly one input/,
    );
  }
});

void test("reads HTML metadata and merges configurable window options with the emitted preload", async (t) => {
  const { root, options, config } = await fixture(t);
  options.windowConfigPath = "display.json";
  await writeFile(
    `${root}/screens/settings/index.html`,
    `<!doctype html>
    <!-- <title>Wrong</title><link rel="icon" href="missing.ico"> -->
    <title>Settings &amp; preferences</title>
    <link href='./app.ico' rel='shortcut icon'><body>Hello</body>`,
  );
  await writeFile(`${root}/screens/settings/app.ico`, "test icon");
  await writeFile(
    `${root}/screens/settings/display.json`,
    JSON.stringify({
      $schema:
        "../../../node_modules/@electron-start/vite-plugin-electron-renderer/window.schema.json",
      title: "Custom title",
      autoHideMenuBar: true,
      width: 900,
      webPreferences: { sandbox: true, preload: "./bridge.js", additionalArguments: ["--test"] },
    }),
  );
  await writeFile(`${root}/panels/help/page.html`, "<title>Help &amp; support</title>");
  await mkdir(`${root}/public`);
  await writeFile(`${root}/public/favicon.ico`, "fallback icon");
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  const result = await data(root);
  const settings = result.renderers["screens/settings"];
  assert.equal(settings.preload, undefined);
  assert.equal(settings.window.$schema, undefined);
  assert.equal(settings.window.title, "Custom title");
  assert.equal(settings.window.autoHideMenuBar, true);
  assert.equal(settings.window.width, 900);
  assert.equal(settings.window.webPreferences.sandbox, true);
  assert.deepEqual(settings.window.webPreferences.additionalArguments, ["--test"]);
  assert.match(settings.window.webPreferences.preload, /custom-.*\.cjs$/);
  assert.equal(await readFile(settings.window.icon, "utf8"), "test icon");
  assert.equal(result.renderers["panels/help"].window.title, "Help & support");
  assert.equal(
    await readFile(result.renderers["panels/help"].window.icon, "utf8"),
    "fallback icon",
  );
  await cp(`${root}/dist`, `${root}/relocated`, { recursive: true });
  const moved = JSON.parse(
    execFileSync(process.execPath, [`${root}/relocated/main/main.js`], { encoding: "utf8" }),
  );
  assert.equal(
    await readFile(moved.renderers["screens/settings"].window.icon, "utf8"),
    "test icon",
  );
});

void test("resolves public HTML icons and window icon overrides", async (t) => {
  const { root, options, config } = await fixture(t);
  config.publicDir = "static";
  await mkdir(`${root}/static`);
  await writeFile(`${root}/static/brand.ico`, "public icon");
  await writeFile(
    `${root}/screens/settings/index.html`,
    '<title>Settings</title><link rel="icon" href="/brand.ico">',
  );
  await writeFile(`${root}/panels/help/custom.ico`, "override icon");
  await writeFile(
    `${root}/panels/help/window.json`,
    JSON.stringify({ icon: "custom.ico", title: "", webPreferences: { sandbox: false } }),
  );
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  const result = await data(root);
  assert.equal(result.renderers["screens/settings"].window.title, "Settings");
  assert.equal(
    await readFile(result.renderers["screens/settings"].window.icon, "utf8"),
    "public icon",
  );
  assert.equal(result.renderers["panels/help"].window.title, "");
  assert.deepEqual(result.renderers["panels/help"].window.webPreferences, { sandbox: false });
  assert.equal(
    await readFile(result.renderers["panels/help"].window.icon, "utf8"),
    "override icon",
  );
});

void test("rejects malformed window options", async (t) => {
  const { root, options, config } = await fixture(t);
  await writeFile(`${root}/screens/settings/window.json`, '{"webPreferences": false}');
  await assert.rejects(async () => {
    await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  }, /webPreferences must be a JSON object/);
});

void test("shares a preload outside renderer directories using a nested custom JSON filename", async (t) => {
  const { root, options, config } = await fixture(t);
  options.windowConfigPath = "config/display.json";
  await mkdir(`${root}/shared`);
  await writeFile(`${root}/shared/bridge.ts`, 'console.log("shared")');
  config.environments.preload.input = "shared/bridge.ts";
  for (const directory of ["screens/settings", "panels/help"]) {
    await mkdir(`${root}/${directory}/config`);
    await writeFile(
      `${root}/${directory}/config/display.json`,
      JSON.stringify({
        webPreferences: { preload: "../../../shared/bridge.ts", sandbox: true },
      }),
    );
  }
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  const result = await data(root);
  const settings = result.renderers["screens/settings"].window.webPreferences;
  assert.equal(settings.preload, result.renderers["panels/help"].window.webPreferences.preload);
  assert.equal(settings.sandbox, true);
  assert.match(await readFile(settings.preload, "utf8"), /shared/);
});

void test("ignores colocated server entries when no preload is declared", async (t) => {
  const { root, options, config } = await fixture(t);
  await rm(`${root}/screens/settings/window.json`);
  await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
  assert.equal((await data(root)).renderers["screens/settings"].window.webPreferences, undefined);
});

void test("validates declared preload sources and requires a matching environment", async (t) => {
  const { root, options, config } = await fixture(t);
  const { readRendererWindow } = await import("./src/index.ts");
  const file = `${root}/screens/settings/window.json`;
  for (const preload of [null, false, 42, "", " "]) {
    await writeFile(file, JSON.stringify({ webPreferences: { preload } }));
    assert.throws(
      () => readRendererWindow(`${root}/screens/settings/index.html`),
      /non-empty string/,
    );
  }
  for (const preload of ["missing.ts", "."]) {
    await writeFile(file, JSON.stringify({ webPreferences: { preload } }));
    assert.throws(
      () => readRendererWindow(`${root}/screens/settings/index.html`),
      /not a file.*window.json/,
    );
  }
  await writeFile(file, JSON.stringify({ webPreferences: { preload: "./bridge.js" } }));
  delete config.environments.preload;
  await assert.rejects(
    createBuilder({ ...config, plugins: [electronRenderer(options)] }),
    /No preload environment/,
  );
});

for (const change of ["add", "change", "remove"]) {
  void test(`restarts Vite when a preload declaration changes (${change})`, async (t) => {
    const { root, options, config } = await fixture(t);
    const file = `${root}/screens/settings/window.json`;
    if (change === "add") await rm(file);
    await writeFile(`${root}/screens/settings/other.js`, 'console.log("other")');
    const server = await createServer({
      ...config,
      server: { ws: false },
      plugins: [electronRenderer(options)],
    });
    t.after(() => server.close());
    let restarts = 0;
    server.restart = async () => {
      restarts++;
    };
    if (change === "remove") await rm(file);
    else
      await writeFile(
        file,
        JSON.stringify({
          webPreferences: { preload: change === "add" ? "./bridge.js" : "./other.js" },
        }),
      );
    // Exercise the watcher callback without binding an HTTP port.
    server.watcher.emit(change === "remove" ? "unlink" : change, file);
    await until(() => restarts === 1);
    server.watcher.emit("change", file);
    assert.equal(restarts, 1);
    await server.close();
    if (change === "change") config.environments.preload.input = "screens/settings/other.js";
    await (await createBuilder({ ...config, plugins: [electronRenderer(options)] })).buildApp();
    const preferences = (await data(root)).renderers["screens/settings"].window.webPreferences;
    if (change === "remove") assert.equal(preferences, undefined);
    else
      assert.match(
        await readFile(preferences.preload, "utf8"),
        change === "add" ? /preload/ : /other/,
      );
  });
}

void test("reloads file-based environments after changing, removing and adding a preload", async (t) => {
  const { root, options, config } = await fixture(t);
  await writeFile(`${root}/screens/settings/other.js`, 'console.log("replacement")');
  const configFile = `${root}/vite.config.mjs`;
  await writeFile(
    configFile,
    `
    import { electronRenderer, readRendererWindow } from ${JSON.stringify(new URL("./src/index.ts", import.meta.url).href)};
    import { buildOnServe } from ${JSON.stringify(new URL("../vite-plugin-build-on-serve/src/index.ts", import.meta.url).href)};
    export default () => {
      const config = ${JSON.stringify(config)};
      const { preload } = readRendererWindow(${JSON.stringify(`${root}/screens/settings/index.html`)});
      if (preload) config.environments.preload.input = preload;
      else delete config.environments.preload;
      return { ...config, plugins: [electronRenderer(${JSON.stringify(options)}), ...(preload ? [buildOnServe("preload")] : []), buildOnServe("electron")] };
    };
  `,
  );
  const server = await createServer({
    configFile,
    server: { port: 0, host: "127.0.0.1", ws: false },
  });
  try {
    await server.listen();
    await until(async () => (await data(root)).mode === "serve");
    const waitForMain = async () => {
      await until(async () => {
        const result = await data(root);
        const preload = result.renderers["screens/settings"].window.webPreferences?.preload;
        const main = await readFile(`${root}/dist/main/main.js`, "utf8");
        return preload ? main.includes(path.basename(preload)) : !main.includes("custom-");
      });
    };
    await waitForMain();
    const file = `${root}/screens/settings/window.json`;
    await writeFile(file, JSON.stringify({ webPreferences: { preload: "./other.js" } }));
    await until(async () => {
      const preload = (await data(root)).renderers["screens/settings"].window.webPreferences
        .preload;
      return (await readFile(preload, "utf8")).includes("replacement");
    });
    await rm(file);
    await until(
      async () => !(await data(root)).renderers["screens/settings"].window.webPreferences,
    );
    assert.equal(server.environments.preload, undefined);
    await waitForMain();
    await writeFile(file, JSON.stringify({ webPreferences: { preload: "./bridge.js" } }));
    await until(async () => {
      const preload = (await data(root)).renderers["screens/settings"].window.webPreferences
        .preload;
      return (await readFile(preload, "utf8")).includes('console.log("preload")');
    });
    assert.ok(server.environments.preload);
    await waitForMain();
  } finally {
    await server.close();
  }
});

void test("discovers view lifecycle changes and recovers missing preloads with a live server", async (t) => {
  const { root, config, options } = await fixture(t);
  const dynamicOptions = {
    ...options,
    viewPatterns: ["views/*", "view"],
    htmlEntry: "page.html",
    windowConfigPath: "config/window.json",
  };
  const configFile = `${root}/vite.config.mjs`;
  await writeFile(
    configFile,
    `
    import { electronRenderer, discoverRendererHtml, readRendererWindow } from ${JSON.stringify(new URL("./src/index.ts", import.meta.url).href)};
    import { buildOnServe } from ${JSON.stringify(new URL("../vite-plugin-build-on-serve/src/index.ts", import.meta.url).href)};
    export default () => {
      const config = ${JSON.stringify(config)};
      const options = ${JSON.stringify(dynamicOptions)};
      const html = discoverRendererHtml(config.root, options.viewPatterns, options.htmlEntry);
      config.environments.client.input = html;
      const template = config.environments.preload;
      delete config.environments.preload;
      const sources = [...new Set(html.flatMap(file => {
        const { preload } = readRendererWindow(file, options.windowConfigPath);
        return preload ? [preload] : [];
      }))];
      const names = sources.map((input, index) => {
        const name = 'preload' + index;
        config.environments[name] = { ...template, input, build: { ...template.build, outDir: 'dist/' + name } };
        return name;
      });
      return { ...config, plugins: [electronRenderer(options), ...names.map(name => buildOnServe(name)), buildOnServe('electron')] };
    };
  `,
  );
  const server = await createServer({
    configFile,
    server: { port: 0, host: "127.0.0.1", ws: false },
  });
  try {
    await server.listen();
    const keys = async (...expected) =>
      until(
        async () =>
          JSON.stringify(Object.keys((await data(root)).renderers).toSorted()) ===
          JSON.stringify(expected.toSorted()),
      );
    await keys();
    const originalServer = server.httpServer;
    await mkdir(`${root}/unrelated`, { recursive: true });
    await writeFile(`${root}/unrelated/page.html`, "Ignored");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(server.httpServer, originalServer);

    await mkdir(`${root}/views/new`, { recursive: true });
    await writeFile(`${root}/views/new/page.html`, "<title>New view</title>");
    await keys("views/new");
    await until(async () =>
      (await readFile(`${root}/dist/main/main.js`, "utf8")).includes("views/new"),
    );
    await mkdir(`${root}/views/new/config`, { recursive: true });
    const windowFile = `${root}/views/new/config/window.json`;
    await writeFile(windowFile, JSON.stringify({ title: "Configured" }));
    await until(
      async () => (await data(root)).renderers["views/new"].window.title === "Configured",
    );

    // A declaration can arrive before its source. Keep watching until the source exists.
    await writeFile(windowFile, JSON.stringify({ webPreferences: { preload: "../bridge.js" } }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(`${root}/views/new/bridge.js`, 'console.log("first preload")');
    const preloadContains = async (text) =>
      until(async () => {
        const file = (await data(root)).renderers["views/new"].window.webPreferences?.preload;
        return (
          file &&
          (await readFile(file, "utf8")).includes(text) &&
          (await readFile(`${root}/dist/main/main.js`, "utf8")).includes(path.basename(file))
        );
      });
    await preloadContains("first preload");
    await rm(`${root}/views/new/bridge.js`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await writeFile(`${root}/views/new/bridge.js`, 'console.log("restored preload")');
    await preloadContains("restored preload");
    await rm(windowFile);
    await until(async () => !(await data(root)).renderers["views/new"].window.webPreferences);

    await rename(`${root}/views/new`, `${root}/views/renamed`);
    await keys("views/renamed");
    await rm(`${root}/views/renamed`, { recursive: true });
    await keys();
    await mkdir(`${root}/view`, { recursive: true });
    await writeFile(`${root}/view/page.html`, "<title>Back</title>");
    await keys("view");
    await rm(`${root}/view/page.html`);
    await keys();
    await writeFile(`${root}/view/page.html`, "<title>Restored HTML</title>");
    await keys("view");
    await until(async () =>
      (await readFile(`${root}/dist/main/main.js`, "utf8")).includes("Restored HTML"),
    );
    // Moving a complete directory into a matching location discovers its preload too.
    await mkdir(`${root}/staging/config`, { recursive: true });
    await writeFile(`${root}/staging/page.html`, "<title>Complete</title>");
    await writeFile(`${root}/staging/bridge.js`, 'console.log("complete preload")');
    await writeFile(
      `${root}/staging/config/window.json`,
      JSON.stringify({ webPreferences: { preload: "../bridge.js" } }),
    );
    await mkdir(`${root}/views`, { recursive: true });
    await rename(`${root}/staging`, `${root}/views/complete`);
    await keys("view", "views/complete");
    await until(async () => {
      const file = (await data(root)).renderers["views/complete"].window.webPreferences.preload;
      return (
        (await readFile(file, "utf8")).includes("complete preload") &&
        (await readFile(`${root}/dist/main/main.js`, "utf8")).includes("views/complete")
      );
    });
    await rm(`${root}/views`, { recursive: true });
    await keys("view");
    await until(
      async () => !(await readFile(`${root}/dist/main/main.js`, "utf8")).includes("views/complete"),
    );
  } finally {
    await server.close();
  }
});
