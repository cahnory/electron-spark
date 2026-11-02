import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** macOS reads the development app's visible name from its native bundle. */
export async function prepareDevElectron(): Promise<void> {
  if (process.platform !== "darwin" || process.env.ELECTRON_OVERRIDE_DIST_PATH) return;

  const require = createRequire(import.meta.url);
  const executable: string = require("electron");
  const source = path.resolve(executable, "../../..");
  const project = path.resolve(import.meta.dirname, "..");
  const { version } = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  const { appId, productName } = JSON.parse(
    await readFile(path.join(project, "electron-builder.json"), "utf8"),
  );
  const cache = path.join(project, "node_modules/.cache/dev-electron");
  const bundle = path.join(cache, `${productName}.app`);
  const bundleId = `${appId}.development`;
  const stamp = JSON.stringify({ source, productName, version, bundleId, revision: 2 });
  const stampPath = path.join(cache, "stamp.json");
  const previous = await readFile(stampPath, "utf8").catch(() => undefined);

  if (previous !== stamp) {
    await mkdir(cache, { recursive: true });
    const staging = path.join(cache, "staging.app");
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, { recursive: true, verbatimSymlinks: true });
    const plist = path.join(staging, "Contents/Info.plist");
    await run("/usr/bin/plutil", ["-replace", "CFBundleName", "-string", productName, plist]);
    await run("/usr/bin/plutil", [
      "-replace",
      "CFBundleDisplayName",
      "-string",
      productName,
      plist,
    ]);
    await run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", bundleId, plist]);
    await run("/usr/bin/plutil", ["-replace", "CFBundleExecutable", "-string", productName, plist]);
    const binaries = path.join(staging, "Contents/MacOS");
    await rename(path.join(binaries, "Electron"), path.join(binaries, productName));
    await symlink(productName, path.join(binaries, "Electron"));
    await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", staging]);
    await rm(bundle, { recursive: true, force: true });
    await rename(staging, bundle);
    // Electron's resolver expects this relative executable path in the override directory.
    await rm(path.join(cache, "Electron.app"), { force: true });
    await symlink(`${productName}.app`, path.join(cache, "Electron.app"));
    await writeFile(stampPath, stamp);
  }
  process.env.ELECTRON_OVERRIDE_DIST_PATH = cache;
  // The lookup above caches Electron's exported executable string. Reload it so
  // the launcher receives the override instead of the stock Electron.app path.
  delete require.cache[require.resolve("electron")];
}
