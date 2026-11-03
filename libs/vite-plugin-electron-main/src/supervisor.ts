/* eslint-disable unicorn/consistent-function-scoping -- The serialized entry must contain its helpers. */
/**
 * Runs in a separate Node process. Keep all runtime dependencies inside this
 * function: its source is the worker entry, including in bundled Vite configs.
 */
export async function superviseElectron() {
  type Launch = { executable: string; entry: string; env: NodeJS.ProcessEnv };
  if (!process.connected) process.exit(0);
  const launch = Promise.withResolvers<Launch | undefined>();
  let stopping = false;
  let requestStop = () => {
    stopping = true;
    launch.resolve(undefined);
  };
  process.once("message", (message: Launch) => launch.resolve(message));
  // Install these before loading modules or waiting for launch instructions.
  process.once("disconnect", () => requestStop());
  process.on("SIGTERM", () => requestStop());
  process.on("SIGINT", () => requestStop());

  const { spawn, execFile, execFileSync } = await import("node:child_process");
  const { setTimeout: delay } = await import("node:timers/promises");
  const { promisify } = await import("node:util");
  const options = await launch.promise;
  if (!options || stopping || !process.connected) process.exit(0);

  function report(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (process.connected) {
      process.send?.(
        {
          type: "error",
          message,
          code: error instanceof Error && "code" in error ? error.code : undefined,
        },
        () => {},
      );
    } else {
      console.error(`electron-main cleanup: ${message}`);
    }
  }

  const windows = process.platform === "win32";
  const child = spawn(options.executable, [options.entry], {
    stdio: "inherit",
    env: options.env,
    detached: !windows,
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", resolve);
    child.once("error", (error) => {
      report(error);
      if (!child.pid) resolve();
    });
  });
  let cleanup: Promise<void> | undefined;

  function signalGroup(signal: NodeJS.Signals | 0) {
    try {
      process.kill(-child.pid!, signal);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      if (
        process.platform === "darwin" &&
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        // macOS can report EPERM for groups containing only unreaped zombies.
        // Confirm there are no live members rather than hiding permission errors.
        const processes = execFileSync("/bin/ps", ["-axo", "pgid=,stat="], {
          encoding: "utf8",
          timeout: 1000,
        });
        const live = processes
          .trim()
          .split("\n")
          .some((line) => {
            const [group, state] = line.trim().split(/\s+/);
            return Number(group) === child.pid && !state?.startsWith("Z");
          });
        if (!live) return false;
      }
      throw error;
    }
  }

  async function terminate() {
    if (!child.pid) return;
    if (windows) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Kill the tree before terminating its root loses the ancestry.
      await promisify(execFile)("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 5000,
      }).catch((error: unknown) => {
        if (
          !(error instanceof Error && "code" in error && error.code === 128) ||
          (child.exitCode === null && child.signalCode === null)
        )
          throw error;
      });
    } else if (signalGroup("SIGTERM")) {
      const deadline = Date.now() + 3000;
      // The leader may exit first. Keep the deadline for surviving descendants.
      while (signalGroup(0)) {
        if (Date.now() >= deadline) {
          signalGroup("SIGKILL");
          break;
        }
        // eslint-disable-next-line no-await-in-loop -- Poll group exit until the grace period expires.
        await delay(50);
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Electron did not exit after cleanup")), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function stop() {
    cleanup ??= terminate().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        report(error);
        process.exit(1);
      },
    );
  }
  requestStop = stop;
  // Also retire the supervisor after a normal quit, crash, or failed spawn.
  void exited.then(stop);
}
