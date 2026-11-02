import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";

const commands: string[] = [];
mock.module("node:child_process", {
  namedExports: {
    execFile(
      command: string,
      _args: string[],
      callback: (error: null, stdout: string, stderr: string) => void,
    ) {
      commands.push(command);
      callback(null, "", "");
    },
  },
});
const { electronAppIdentity, prepareElectronAppIdentity } = await import("../src/index.ts");

void test("development plugin prepares and caches the consuming project's Electron bundle", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "electron-dev-"));
  const platform = process.platform;
  const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
  t.after(async () => {
    Object.defineProperty(process, "platform", { value: platform });
    if (override === undefined) delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
    else process.env.ELECTRON_OVERRIDE_DIST_PATH = override;
    await rm(root, { recursive: true, force: true });
  });
  Object.defineProperty(process, "platform", { value: "darwin" });
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  const electron = path.join(root, "node_modules/electron");
  const executable = path.join(electron, "dist/Electron.app/Contents/MacOS/Electron");
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, "binary");
  await writeFile(
    path.join(electron, "package.json"),
    JSON.stringify({ version: "45.0.0", main: "index.cjs" }),
  );
  await writeFile(
    path.join(electron, "index.cjs"),
    `module.exports = ${JSON.stringify(executable)};`,
  );
  await writeFile(path.join(root, "package.json"), JSON.stringify({ version: "1.0.0" }));
  const options = { projectDir: root, productName: "Example", appId: "example.app" };
  assert.equal(electronAppIdentity(options).apply, "serve");
  await prepareElectronAppIdentity(options);
  const cache = path.join(root, "node_modules/.cache/dev-electron");
  assert.equal(process.env.ELECTRON_OVERRIDE_DIST_PATH, cache);
  assert.equal(
    await readFile(path.join(cache, "Electron.app/Contents/MacOS/Electron"), "utf8"),
    "binary",
  );
  assert.equal(
    await realpath(path.join(cache, "Electron.app")),
    await realpath(path.join(cache, "Example.app")),
  );
  assert.ok(commands.includes("/usr/bin/codesign"));
  const count = commands.length;
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  await prepareElectronAppIdentity(options);
  assert.equal(commands.length, count);
  // An explicit distribution override takes precedence, even with an invalid project.
  await prepareElectronAppIdentity({ projectDir: "/missing" });
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  await assert.rejects(
    prepareElectronAppIdentity({ ...options, productName: "../escape" }),
    /filename/,
  );
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  await prepareElectronAppIdentity({ ...options, productName: "Electron" });
  assert.equal(
    await readFile(path.join(cache, "Electron.app/Contents/MacOS/Electron"), "utf8"),
    "binary",
  );
  delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
  await prepareElectronAppIdentity(options);
  assert.equal(
    await realpath(path.join(cache, "Electron.app")),
    await realpath(path.join(cache, "Example.app")),
  );
  assert.equal(
    await readFile(path.join(cache, "Electron.app/Contents/MacOS/Electron"), "utf8"),
    "binary",
  );
  for (const productName of ["staging", "electron", "ELECTRON", "Example"]) {
    delete process.env.ELECTRON_OVERRIDE_DIST_PATH;
    // oxlint-disable-next-line no-await-in-loop -- Exercise successive identity changes in the same cache.
    await prepareElectronAppIdentity({ ...options, productName });
    assert.equal(
      // oxlint-disable-next-line no-await-in-loop -- Verify each identity before replacing its cached bundle.
      await readFile(path.join(cache, "Electron.app/Contents/MacOS/Electron"), "utf8"),
      "binary",
      `The launcher must resolve the executable for ${productName}`,
    );
  }
  Object.defineProperty(process, "platform", { value: "linux" });
  await prepareElectronAppIdentity({ projectDir: "/missing" });
});
