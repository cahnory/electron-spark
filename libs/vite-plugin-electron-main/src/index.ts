import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { buildOnServe } from "@electron-spark/vite-plugin-build-on-serve";
import type { Plugin, ViteDevServer } from "vite";

/** Build and restart only the configured Electron main environment in dev. */
export function electronMain(environmentName = "electron"): Plugin[] {
  return [
    {
      name: "@electron-spark/vite-plugin-electron-main",
      enforce: "pre",
      applyToEnvironment: (environment) => environment.name === environmentName,
      resolveId(id) {
        if (id === "electron" || id === "electron/main" || id === "electron/common") {
          return { id, external: true };
        }
        return null;
      },
    },
    buildOnServe(environmentName, {
      session(server) {
        const session = createSession(server);
        return { ...session, plugins: [session.launch] };
      },
    }),
  ];
}

function createSession(server: ViteDevServer) {
  const require = createRequire(path.resolve(server.config.root, "package.json"));
  const electronPath: string = require("electron");
  // macOS uses the launched bundle's identity for the Dock and app switcher.
  const executable = process.platform === "darwin" ? realpathSync(electronPath) : electronPath;
  let child: ChildProcess | undefined;
  let closed = false;
  let pending = Promise.resolve();
  let entry: string | undefined;

  async function stop() {
    const previous = child;
    child = undefined;
    if (!previous?.pid || previous.exitCode !== null || previous.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => previous.kill("SIGKILL"), 3000);
      previous.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      previous.kill("SIGTERM");
    });
  }

  return {
    close: async () => {
      closed = true;
      await pending;
      await stop();
    },
    buildStart() {
      entry = undefined;
    },
    buildSuccess() {
      const builtEntry = entry;
      if (!builtEntry || closed) return pending;
      pending = pending
        .then(async () => {
          await stop();
          if (closed) return;
          const env = { ...process.env };
          delete env.ELECTRON_RUN_AS_NODE;
          child = spawn(executable, [builtEntry], { stdio: "inherit", env });
          child.on("error", (error) => server.config.logger.error(error.message));
        })
        .catch((error: unknown) => {
          server.config.logger.error(String(error));
        });
      return pending;
    },
    launch: {
      name: "electron-main-launch",
      writeBundle(options, bundle) {
        const entries = Object.values(bundle).filter(
          (output) => output.type === "chunk" && output.isEntry,
        );
        if (entries.length !== 1) {
          throw new Error("Electron main requires exactly one entry point.");
        }
        // Use the first written output, but only launch after the whole cycle succeeds.
        entry ??= path.resolve(options.dir ?? path.dirname(options.file!), entries[0].fileName);
      },
    } satisfies Plugin,
  };
}
