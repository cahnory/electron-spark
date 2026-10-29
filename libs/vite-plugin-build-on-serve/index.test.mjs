import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createServer as createViteServer, createLogger, DevEnvironment } from "vite";

import { buildOnServe } from "./src/index.ts";

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

void test("an initial configure failure never starts a watched builder", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vite-startup-failure-")));
  let started = false;
  let closed = 0;
  let failedServer;
  try {
    await writeFile(path.join(root, "main.js"), "console.log('main');");
    await assert.rejects(
      createServer({
        configFile: false,
        root,
        logLevel: "silent",
        server: { middlewareMode: true, ws: false },
        environments: {
          main: {
            consumer: "server",
            input: "main.js",
            build: { ssr: true, outDir: path.join(root, "dist") },
          },
        },
        plugins: [
          buildOnServe("main", {
            plugins: [
              {
                name: "watch-probe",
                buildStart() {
                  started = true;
                },
                closeWatcher() {
                  closed++;
                },
              },
            ],
          }),
          {
            name: "failing-configuration",
            configureServer(server) {
              failedServer = server;
              throw new Error("initial configuration failed");
            },
          },
        ],
      }),
      /initial configuration failed/,
    );
    assert.equal(started, false);
    assert.equal(closed, 0);
  } finally {
    // Vite owns its dev-server watcher even when configuration fails.
    await failedServer?.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test("close waits for a delayed watcher initialization", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vite-delayed-watcher-")));
  const gate = Promise.withResolvers();
  const optionsEntered = Promise.withResolvers();
  let server;
  let watcherClosed = 0;
  let buildStarted = 0;
  try {
    await writeFile(path.join(root, "main.js"), "console.log('main');");
    server = await createServer({
      configFile: false,
      root,
      logLevel: "silent",
      server: { middlewareMode: true, ws: false },
      environments: {
        main: {
          consumer: "server",
          input: "main.js",
          build: { ssr: true, outDir: path.join(root, "dist") },
        },
      },
      plugins: [
        buildOnServe("main", {
          plugins: [
            {
              name: "delayed-options",
              async options() {
                optionsEntered.resolve();
                await gate.promise;
              },
              buildStart() {
                buildStarted++;
              },
              closeWatcher() {
                watcherClosed++;
              },
            },
          ],
        }),
      ],
    });
    await optionsEntered.promise;
    let finished = false;
    const closing = server.close().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(finished, false, "close must wait until the native watcher exists");
    gate.resolve();
    await closing;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(buildStarted, watcherClosed, "no initialized build may survive close");
  } finally {
    gate.resolve();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});

for (const restartFailure of [false, true]) {
  void test(`a sibling listen failure starts no replacement build during ${restartFailure ? "restart" : "startup"}`, async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "vite-sibling-failure-")));
    const started = Promise.withResolvers();
    let failing = !restartFailure;
    let server;
    let sessions = 0,
      sessionsClosed = 0,
      watchersClosed = 0;
    try {
      await writeFile(path.join(root, "main.js"), "console.log('main');");
      const config = {
        configFile: false,
        root,
        logLevel: "silent",
        server: { middlewareMode: true, ws: false },
        environments: {
          client: {
            dev: {
              createEnvironment(name, resolved) {
                const environment = new DevEnvironment(name, resolved, { hot: false });
                environment.listen = async () => {
                  if (failing) throw new Error("sibling listen failed");
                };
                return environment;
              },
            },
          },
          main: {
            consumer: "server",
            input: "main.js",
            build: { ssr: true, outDir: path.join(root, "dist") },
          },
        },
        plugins: [
          buildOnServe("main", {
            session() {
              sessions++;
              return {
                async close() {
                  sessionsClosed++;
                },
              };
            },
            plugins: [
              {
                name: "watch-probe",
                buildStart() {
                  started.resolve();
                },
                closeWatcher() {
                  watchersClosed++;
                },
              },
            ],
          }),
        ],
      };
      if (restartFailure) {
        server = await createServer(config);
        await started.promise;
        failing = true;
        await assert.rejects(server.restart(), /sibling listen failed/);
      } else {
        await assert.rejects(createServer(config), /sibling listen failed/);
      }
      const expected = restartFailure ? 1 : 0;
      assert.equal(sessions, expected);
      assert.equal(sessionsClosed, expected);
      assert.equal(watchersClosed, expected);
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

void test("a session setup failure is logged and closes its resources exactly once", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vite-session-failure-")));
  const errors = [];
  let closed = 0;
  let server;
  try {
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
      environments: { main: { consumer: "server" } },
      plugins: [
        buildOnServe("main", {
          session() {
            return {
              async close() {
                closed++;
              },
            };
          },
          plugins() {
            throw new Error("session setup failed");
          },
        }),
      ],
    });
    await waitFor(() => errors.length);
    assert.match(errors[0], /session setup failed/);
    assert.equal(closed, 1);
    await server.close();
    await server.close();
    assert.equal(closed, 1);
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
