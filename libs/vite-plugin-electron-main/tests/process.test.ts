import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "tsdown";

import { launchElectron } from "../src/process.ts";
import { superviseElectron } from "../src/supervisor.ts";

function running(pid: number) {
  try {
    process.kill(pid, 0);
    if (process.platform !== "win32") {
      // Orphans can remain zombies until the host's init reaps them.
      return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
        .trim()
        .startsWith("Z");
    }
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  deadline = Date.now() + 10000,
): Promise<void> {
  if (await check()) return;
  assert(Date.now() < deadline, "timed out waiting for processes");
  await delay(50);
  return waitFor(check, deadline);
}

for (const mode of [
  "graceful",
  "stubborn",
  "external-exit",
  "owner-killed",
  "supervisor-term",
] as const) {
  void test(
    `cleanup nested processes: ${mode}`,
    {
      timeout: 15000,
      skip:
        (mode === "external-exit" || mode === "supervisor-term") && process.platform === "win32",
    },
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "electron-tree-"));
      const entry = path.join(root, "main.cjs");
      const errors: unknown[] = [];
      let electron: ReturnType<typeof launchElectron> | undefined;
      let owner: ReturnType<typeof spawn> | undefined;
      let ownerExit: Promise<void> | undefined;
      let supervisorPid: number | undefined;
      const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      const unrelatedExit = new Promise<void>((resolve) => unrelated.once("exit", resolve));
      const pids: Record<string, number> = {};
      try {
        await writeFile(
          entry,
          `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const role = process.argv[2] || 'main';
if (role === 'main') fs.writeFileSync(${JSON.stringify(root)} + '/supervisor.pid', String(process.ppid));
if (role !== 'leaf') spawn(process.execPath, [__filename, role === 'main' ? 'helper' : 'leaf'], { stdio: 'ignore' });
if (${JSON.stringify(mode)} !== 'graceful' && role === 'leaf') process.on('SIGTERM', () => {});
if (${JSON.stringify(mode)} === 'graceful') process.on('SIGTERM', () => {
  fs.writeFileSync(${JSON.stringify(root)} + '/' + role + '.stopped', 'graceful');
  process.exit(0);
});
fs.writeFileSync(${JSON.stringify(root)} + '/' + role + '.pid', String(process.pid));
setInterval(() => {}, 1000);
`,
        );
        if (mode === "owner-killed") {
          await writeFile(
            path.join(root, "owner.mjs"),
            `
import { launchElectron } from ${JSON.stringify(new URL("../src/process.ts", import.meta.url).href)};
launchElectron(process.execPath, ${JSON.stringify(entry)}, process.env, console.error);
setInterval(() => {}, 1000);
`,
          );
          owner = spawn(process.execPath, [path.join(root, "owner.mjs")], { stdio: "inherit" });
          ownerExit = new Promise<void>((resolve) => owner!.once("exit", resolve));
        } else {
          electron = launchElectron(process.execPath, entry, process.env, (error) =>
            errors.push(error),
          );
        }
        await waitFor(async () => {
          const ready = await Promise.all(
            ["main", "helper", "leaf"].map(async (role) => {
              try {
                pids[role] = Number(await readFile(path.join(root, `${role}.pid`), "utf8"));
                return true;
              } catch {
                return false;
              }
            }),
          );
          return ready.every(Boolean);
        });
        assert(Object.values(pids).every(running));
        supervisorPid = Number(await readFile(path.join(root, "supervisor.pid"), "utf8"));
        assert(running(supervisorPid));
        if (mode === "owner-killed") {
          owner!.kill("SIGKILL");
          await ownerExit;
          await waitFor(() => !running(supervisorPid!));
        } else if (mode === "supervisor-term") {
          process.kill(supervisorPid, "SIGTERM");
          await waitFor(() => !running(supervisorPid!));
        }
        if (mode === "external-exit") {
          process.kill(pids.main, "SIGKILL");
          // Automatic cleanup must run without a plugin stop or rebuild.
          await waitFor(() => Object.values(pids).every((pid) => !running(pid)));
        }
        const firstStop = electron?.stop();
        assert.equal(electron?.stop(), firstStop, "concurrent cleanup shares one operation");
        await firstStop;
        await waitFor(() => Object.values(pids).every((pid) => !running(pid)));
        await electron?.stop();
        await waitFor(() => !running(supervisorPid!));
        assert(running(unrelated.pid!), "cleanup must not signal the Vite process group");
        assert.deepEqual(errors, []);
        if (mode === "graceful" && process.platform !== "win32") {
          await Promise.all(
            Object.keys(pids).map(async (role) => {
              assert.equal(await readFile(path.join(root, `${role}.stopped`), "utf8"), "graceful");
            }),
          );
        }
      } finally {
        await electron?.stop().catch(() => {});
        owner?.kill("SIGKILL");
        await ownerExit;
        if (supervisorPid && running(supervisorPid)) {
          process.kill(supervisorPid, "SIGTERM");
          await waitFor(() => !running(supervisorPid!));
        }
        for (const pid of Object.values(pids)) {
          if (running(pid)) process.kill(pid, "SIGKILL");
        }
        unrelated.kill("SIGKILL");
        await unrelatedExit;
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

void test("a failed spawn is reported and cleanup settles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "electron-missing-"));
  const errors: unknown[] = [];
  try {
    const electron = launchElectron(path.join(root, "missing"), "main.js", process.env, (error) =>
      errors.push(error),
    );
    await waitFor(() => errors.length === 1);
    await electron.stop();
    assert(errors[0] instanceof Error && "code" in errors[0]);
    assert.equal(errors[0].code, "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("closing immediately during supervisor startup settles", { timeout: 10000 }, async () => {
  const errors: unknown[] = [];
  const electron = launchElectron(process.execPath, "unused-entry.js", process.env, (error) =>
    errors.push(error),
  );
  await electron.stop();
  assert.deepEqual(errors, []);
});

void test("supervisor startup without an owner channel exits promptly", () => {
  execFileSync(
    process.execPath,
    ["--input-type=commonjs", "-e", `(${superviseElectron.toString()})()`],
    {
      timeout: 5000,
      stdio: "pipe",
    },
  );
});

for (const format of ["esm", "cjs"] as const) {
  void test(`supervisor works from a bundled ${format} launcher`, { timeout: 15000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "electron-bundled-"));
    const entry = path.join(root, "main.cjs");
    const errors: unknown[] = [];
    let electron: ReturnType<typeof launchElectron> | undefined;
    let pid: number | undefined;
    try {
      await build({
        config: false,
        entry: { launcher: fileURLToPath(new URL("../src/process.ts", import.meta.url)) },
        outDir: path.join(root, "dist"),
        outExtensions: () => ({ js: format === "cjs" ? ".cjs" : ".mjs" }),
        format,
        platform: "neutral",
        deps: { neverBundle: true },
        dts: false,
        logLevel: "silent",
      });
      const bundled = await import(
        pathToFileURL(path.join(root, "dist", format === "cjs" ? "launcher.cjs" : "launcher.mjs"))
          .href
      );
      await writeFile(
        entry,
        `
require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "ready"))}, JSON.stringify({ pid: process.pid, supervisor: process.ppid, value: process.env.ELECTRON_SPARK_TEST_VALUE }));
setInterval(() => {}, 1000);
`,
      );
      electron = bundled.launchElectron(
        process.execPath,
        entry,
        { ...process.env, ELECTRON_SPARK_TEST_VALUE: "preserved" },
        (error: unknown) => errors.push(error),
      );
      await waitFor(async () => {
        try {
          await readFile(path.join(root, "ready"));
          return true;
        } catch {
          return false;
        }
      });
      const ready = JSON.parse(await readFile(path.join(root, "ready"), "utf8"));
      pid = ready.pid;
      assert.equal(ready.value, "preserved");
      assert(running(ready.pid));
      await electron!.stop();
      assert(!running(ready.pid));
      assert(!running(ready.supervisor));
      assert.deepEqual(errors, []);
    } finally {
      await electron?.stop().catch(() => {});
      if (pid && running(pid)) process.kill(pid, "SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const live of [false, true]) {
  void test(
    `macOS group EPERM ${live ? "reports a live member" : "tolerates a vanished group"}`,
    { skip: process.platform !== "darwin", timeout: 10000 },
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "electron-permission-"));
      const entry = path.join(root, "main.cjs");
      let pid: number | undefined;
      let supervisor: ReturnType<typeof spawn> | undefined;
      try {
        await writeFile(
          entry,
          `
require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "pid"))}, String(process.pid));
${live ? "setInterval(() => {}, 1000);" : "process.exit(0);"}
`,
        );
        supervisor = spawn(
          process.execPath,
          [
            "--input-type=commonjs",
            "-e",
            `
process.kill = () => { throw Object.assign(new Error('simulated group permission error'), { code: 'EPERM' }); };
(${superviseElectron.toString()})().catch(() => process.exit(1));
`,
          ],
          { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
        );
        const exited = new Promise<number | null>((resolve) => supervisor!.once("exit", resolve));
        supervisor.send({ executable: process.execPath, entry, env: process.env });
        await waitFor(async () => {
          try {
            pid = Number(await readFile(path.join(root, "pid"), "utf8"));
            return true;
          } catch {
            return false;
          }
        });
        if (live) supervisor.disconnect();
        assert.equal(await exited, live ? 1 : 0);
        assert.equal(
          running(pid!),
          live,
          "a live process must not be mistaken for a zombie-only group",
        );
      } finally {
        supervisor?.kill("SIGKILL");
        if (pid && running(pid)) process.kill(pid, "SIGKILL");
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
