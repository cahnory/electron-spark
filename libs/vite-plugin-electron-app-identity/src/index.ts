import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

import type { Plugin } from "vite";

export interface ElectronAppIdentityOptions {
  /** Application directory containing package.json and electron-builder.json. Defaults to cwd. */
  projectDir?: string;
  productName?: string;
  appId?: string;
}

export function electronAppIdentity(options: ElectronAppIdentityOptions = {}): Plugin {
  return {
    name: "electron-spark:electron-app-identity",
    apply: "serve",
    configResolved: () => prepareElectronAppIdentity(options),
  };
}

const run = promisify(execFile);

/** macOS reads the development app's visible name from its native bundle. */
export async function prepareElectronAppIdentity(
  options: ElectronAppIdentityOptions = {},
): Promise<void> {
  if (process.platform !== "darwin" || process.env.ELECTRON_OVERRIDE_DIST_PATH) return;

  const project = path.resolve(options.projectDir ?? process.cwd());
  const require = createRequire(path.join(project, "package.json"));
  const executable: string = require("electron");
  const source = path.resolve(executable, "../../..");
  const { version } = JSON.parse(await readFile(path.join(project, "package.json"), "utf8"));
  const config =
    options.appId && options.productName
      ? options
      : JSON.parse(await readFile(path.join(project, "electron-builder.json"), "utf8"));
  const appId = options.appId ?? config.appId;
  const productName = options.productName ?? config.productName;
  if (
    typeof productName !== "string" ||
    !productName.trim() ||
    // oxlint-disable-next-line no-control-regex -- Native filenames must not contain control characters.
    /[\\/\x00-\x1f]/.test(productName) ||
    productName === "." ||
    productName === ".."
  ) {
    throw new Error("productName must be a non-empty filename");
  }
  if (typeof appId !== "string" || !appId.trim()) throw new Error("appId is required");
  const cache = path.join(project, "node_modules/.cache/dev-electron");
  // Keep the resolver paths canonical on case-insensitive macOS volumes.
  const nativeName = productName.toLowerCase() === "electron" ? "Electron" : productName;
  const bundle = path.join(cache, `${nativeName}.app`);
  const bundleId = `${appId}.development`;
  const stamp = JSON.stringify({
    source,
    electronVersion: require("electron/package.json").version,
    productName,
    version,
    bundleId,
    revision: 3,
  });
  const stampPath = path.join(cache, "stamp.json");
  const previous = await readFile(stampPath, "utf8").catch(() => undefined);

  if (previous !== stamp) {
    await mkdir(cache, { recursive: true });
    const stagingRoot = await mkdtemp(path.join(cache, ".staging-"));
    const staging = path.join(stagingRoot, "Electron.app");
    try {
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
      await run("/usr/bin/plutil", [
        "-replace",
        "CFBundleExecutable",
        "-string",
        nativeName,
        plist,
      ]);
      const binaries = path.join(staging, "Contents/MacOS");
      if (nativeName !== "Electron") {
        await rename(path.join(binaries, "Electron"), path.join(binaries, nativeName));
        await symlink(nativeName, path.join(binaries, "Electron"));
      }
      await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", staging]);
      await rm(bundle, { recursive: true, force: true });
      await rename(staging, bundle);
      // Electron's resolver expects this relative executable path in the override directory.
      if (nativeName !== "Electron")
        await rm(path.join(cache, "Electron.app"), { recursive: true, force: true });
      if (nativeName !== "Electron")
        await symlink(`${nativeName}.app`, path.join(cache, "Electron.app"));
      await writeFile(stampPath, stamp);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  }
  process.env.ELECTRON_OVERRIDE_DIST_PATH = cache;
  // The lookup above caches Electron's exported executable string. Reload it so
  // the launcher receives the override instead of the stock Electron.app path.
  delete require.cache[require.resolve("electron")];
}
