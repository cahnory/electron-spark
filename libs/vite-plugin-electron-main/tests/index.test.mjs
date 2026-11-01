import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createServer as createViteServer,
  createLogger,
  createBuilder,
  DevEnvironment,
} from "vite";

import { electronMain } from "../src/index.ts";

// Exercise the standalone HTTP lifecycle without opening a network port.
// Vite itself calls the environment listeners before the HTTP listening event.
async function createServer(options) {
  const server = await createViteServer({
    ...options,
    server: { ...options.server, middlewareMode: false, ws: false },
    plugins: [
      {
        name: "test-http-transport",
        configureServer(candidate) {
          candidate.httpServer.address = () => ({ port: 0, address: "127.0.0.1", family: "IPv4" });
          candidate.listen = async () => {
            await Promise.all(
              Object.values(candidate.environments).map((environment) =>
                environment.listen(candidate),
              ),
            );
            candidate.httpServer.emit("listening");
            return candidate;
          };
        },
      },
      ...(options.plugins ?? []),
    ],
  });
  try {
    await server.listen();
    return server;
  } catch (error) {
    await server.close();
    throw error;
  }
}

async function waitFor(fn, attempts = 100) {
  if (await fn()) return;
  if (attempts === 0) throw Error("timeout");
  await new Promise((resolve) => setTimeout(resolve, 50));
  return waitFor(fn, attempts - 1);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

for (const fromFile of [false, true]) {
  for (const failureKind of ["configure", "post"]) {
    void test(`restart, rebuild and close (${fromFile ? "fresh plugins from config file" : "reused inline plugins"}; ${failureKind} failure)`, async () => {
      const root = await realpath(await mkdtemp(path.join(tmpdir(), "electron-lifecycle-")));
      await mkdir(`${root}/node_modules/electron`, { recursive: true });
      await writeFile(
        `${root}/node_modules/electron/package.json`,
        JSON.stringify({ main: "index.cjs" }),
      );
      await writeFile(`${root}/node_modules/electron/index.cjs`, "module.exports=process.execPath");
      await writeFile(
        `${root}/main.js`,
        `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(root + "/pids")}, process.pid+',');setInterval(()=>{},1000);`,
      );
      if (fromFile) {
        await writeFile(
          `${root}/vite.config.mjs`,
          `import { electronMain } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)}; export default { plugins: electronMain() };`,
        );
      }
      let launcher,
        closes = 0,
        buildFailed = false,
        failure,
        failedServer;
      const pids = async () => {
        try {
          return (await readFile(`${root}/pids`, "utf8")).split(",").filter(Boolean).map(Number);
        } catch {
          return [];
        }
      };
      let server;
      try {
        server = await createServer({
          configFile: fromFile ? `${root}/vite.config.mjs` : false,
          configLoader: "native",
          root,
          logLevel: "silent",
          server: { middlewareMode: true, ws: false },
          environments: {
            electron: {
              consumer: "server",
              input: "main.js",
              build: { ssr: true, outDir: `${root}/dist` },
            },
          },
          plugins: [
            ...(fromFile ? [] : electronMain()),
            {
              name: "probe",
              configureServer(candidate) {
                if (!failure) return undefined;
                failedServer = candidate;
                if (failure === "post") {
                  return () => {
                    throw new Error("Simulated post-configure failure");
                  };
                }
                throw new Error("Simulated configure failure");
              },
              buildStart() {
                if (this.environment.name === "electron")
                  launcher = this.environment.plugins.find(
                    (p) => p.name === "electron-main-launch",
                  );
              },
              buildEnd(error) {
                if (error) buildFailed = true;
              },
              closeWatcher() {
                closes++;
              },
            },
          ],
        });
        await waitFor(() => launcher);
        const originalProbe = server.config.inlineConfig.plugins.at(-1);
        assert.equal(
          server.config.plugins.find((plugin) => plugin.name === "probe"),
          originalProbe,
          "other plugins must not be cloned or rewritten",
        );
        await waitFor(async () => (await pids()).length === 1);
        const [first] = await pids();
        assert(alive(first));
        launcher = undefined;
        await server.restart();
        await waitFor(() => launcher);
        assert(!alive(first), "old child must exit on restart");
        assert.equal(closes, 1);
        await waitFor(async () => (await pids()).length === 2);
        const second = (await pids())[1];
        assert(alive(second), "new session must launch");
        const source = await readFile(`${root}/main.js`, "utf8");
        await writeFile(`${root}/main.js`, "export const = ;");
        await waitFor(() => buildFailed);
        assert(alive(second), "a compilation error must keep the previous child alive");
        assert.equal((await pids()).length, 2);
        await writeFile(`${root}/main.js`, source + "\n// rebuild");
        await waitFor(async () => (await pids()).length === 3);
        assert(!alive(second), "rebuild must stop previous child");
        const third = (await pids())[2];
        assert(alive(third));
        launcher = undefined;
        failure = failureKind;
        await server.restart();
        assert.equal((await pids()).length, 3, "failed configuration must not launch a process");
        assert.equal(launcher, undefined, "failed configuration must not start a build");
        assert(alive(third), "failed restart must keep the original child alive");
        assert.equal(closes, 1, "failed configuration must not create a watcher to close");
        // Vite owns the partial server; our plugin has created no resources.
        await failedServer.close();
        failedServer = undefined;
        failure = undefined;
        launcher = undefined;
        await server.restart();
        await waitFor(() => launcher);
        assert(!alive(third), "recovery must replace the original child");
        await waitFor(async () => (await pids()).length === 4);
        const recovered = (await pids())[3];
        assert(alive(recovered), "recovery must launch a fresh session");
        await server.close();
        server = undefined;
        assert(!alive(third), "close must stop current child");
        assert(!alive(recovered), "final close must stop the recovered child");
        assert.equal(closes, 3);
      } finally {
        await server?.close();
        await failedServer?.close();
        for (const pid of await pids()) if (alive(pid)) process.kill(pid, "SIGKILL");
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

const createTestEnvironment = (name, config) => new DevEnvironment(name, config, { hot: false });

void test("serve preserves the environment factory and waits for output hooks before launching", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "electron-output-")));
  let server;
  try {
    await mkdir(`${root}/node_modules/electron`, { recursive: true });
    await writeFile(
      `${root}/node_modules/electron/package.json`,
      JSON.stringify({ main: "index.cjs" }),
    );
    await writeFile(`${root}/node_modules/electron/index.cjs`, "module.exports=process.execPath");
    await writeFile(
      `${root}/main.js`,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(root + "/launched")}, fs.readFileSync(${JSON.stringify(root + "/ready")}, 'utf8'));`,
    );
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      environments: {
        electron: {
          consumer: "server",
          input: "main.js",
          dev: { createEnvironment: createTestEnvironment },
          build: { ssr: true, outDir: `${root}/dist` },
        },
      },
      plugins: [
        ...electronMain(),
        {
          name: "write-required-file",
          async writeBundle() {
            await new Promise((resolve) => setTimeout(resolve, 150));
            await writeFile(`${root}/ready`, "ready");
          },
        },
      ],
    });
    assert.equal(server.config.environments.electron.dev.createEnvironment, createTestEnvironment);
    await waitFor(async () => {
      try {
        return (await readFile(`${root}/launched`, "utf8")) === "ready";
      } catch {
        return false;
      }
    });
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("Electron runtime imports stay external in production, including noExternal builds", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "electron-external-")));
  try {
    await writeFile(
      `${root}/main.js`,
      "import { app } from 'electron/main'; import { nativeImage } from 'electron/common'; console.log(app, nativeImage);",
    );
    const builder = await createBuilder({
      configFile: false,
      root,
      logLevel: "silent",
      environments: {
        electron: {
          consumer: "server",
          input: "main.js",
          resolve: { noExternal: true },
          build: { ssr: true, write: false },
        },
      },
      plugins: electronMain(),
    });
    const result = await builder.build(builder.environments.electron);
    assert.match(result.output[0].code, /from ["']electron\/main["']/);
    assert.match(result.output[0].code, /from ["']electron\/common["']/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test(
  "multiple outputs launch once after all writes, and a failed output keeps the previous process",
  { timeout: 15000 },
  async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "electron-multiple-outputs-")));
    let server;
    let failOutput = false;
    let gate = Promise.withResolvers();
    let entered = Promise.withResolvers();
    const errors = [];
    const launches = async () => {
      try {
        return (await readFile(`${root}/launches`, "utf8")).trim().split("\n").map(JSON.parse);
      } catch {
        return [];
      }
    };
    try {
      await mkdir(`${root}/node_modules/electron`, { recursive: true });
      await writeFile(
        `${root}/node_modules/electron/package.json`,
        JSON.stringify({ main: "index.cjs" }),
      );
      await writeFile(`${root}/node_modules/electron/index.cjs`, "module.exports=process.execPath");
      const source = `import fs from 'node:fs';
      fs.appendFileSync(${JSON.stringify(root + "/launches")}, JSON.stringify({ pid: process.pid, entry: import.meta.url, ready: fs.existsSync(${JSON.stringify(root + "/ready")}) })+'\\n');
      setInterval(()=>{},1000);`;
      await writeFile(`${root}/main.js`, source);
      server = await createServer({
        configFile: false,
        root,
        logLevel: "silent",
        customLogger: {
          ...createLogger("silent"),
          error(message) {
            errors.push(message);
          },
        },
        environments: {
          electron: {
            consumer: "server",
            input: "main.js",
            build: {
              ssr: true,
              outDir: `${root}/dist`,
              rolldownOptions: {
                output: [
                  { format: "es", entryFileNames: "first.mjs" },
                  { format: "es", entryFileNames: "second.mjs" },
                ],
              },
            },
          },
        },
        plugins: [
          ...electronMain(),
          {
            name: "hold-second-output",
            async writeBundle(options) {
              if (options.entryFileNames !== "second.mjs") return;
              entered.resolve();
              await gate.promise;
              if (failOutput) throw new Error("second output failed");
              await writeFile(`${root}/ready`, "ready");
            },
          },
        ],
      });
      await entered.promise;
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await launches()).length, 0, "must not launch while another output is pending");
      gate.resolve();
      await waitFor(async () => (await launches()).length === 1);
      const [first] = await launches();
      assert.equal(first.ready, true);
      assert.match(first.entry, /first\.mjs$/);

      failOutput = true;
      await writeFile(`${root}/main.js`, source + "\n// failed rebuild");
      await waitFor(() => errors.some((message) => message.includes("second output failed")));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await launches()).length, 1, "a partially successful build must not launch");
      assert(alive(first.pid));

      failOutput = false;
      gate = Promise.withResolvers();
      entered = Promise.withResolvers();
      await writeFile(`${root}/main.js`, source + "\n// recovered rebuild");
      await entered.promise;
      assert.equal((await launches()).length, 1);
      assert(alive(first.pid));
      gate.resolve();
      await waitFor(async () => (await launches()).length === 2);
      assert(!alive(first.pid));
      await server.close();
      assert.equal((await launches()).length, 2);
      assert(!alive((await launches())[1].pid));
    } finally {
      gate.resolve();
      await server?.close();
      for (const { pid } of await launches()) if (alive(pid)) process.kill(pid, "SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);
