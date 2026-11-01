import { open, readdir, rm } from "node:fs/promises";
import path from "node:path";

const assetExtensions = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".html",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".wasm",
]);

export function verifyEntries(entries) {
  for (const entry of entries) {
    const parts = entry.split("/");
    if (entry === "package.json") continue;
    if (
      parts[0] !== "dist" ||
      parts.some(
        (part) => part.startsWith(".") || /^(?:secrets?|credentials?)(?:[.-]|$)/i.test(part),
      ) ||
      !assetExtensions.has(path.posix.extname(entry).toLowerCase())
    ) {
      throw new Error(`Unexpected packaged file: ${entry}. Review the release asset policy.`);
    }
  }
  for (const required of ["package.json", "dist/main/index.js", "dist/view/index.html"]) {
    if (!entries.includes(required)) throw new Error(`Missing packaged entry: ${required}`);
  }
}

export function requireNotarizationCredentials(env) {
  if (
    !(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) &&
    !(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) &&
    !env.APPLE_KEYCHAIN_PROFILE
  ) {
    throw new Error("Release packaging requires macOS notarization credentials. See README.md.");
  }
}

export async function verifyArchive(archive) {
  const file = await open(archive, "r");
  try {
    // ASAR starts with a size pickle followed by a pickle containing JSON metadata.
    const prefix = Buffer.alloc(16);
    await file.read(prefix, 0, prefix.length, 0);
    const length = prefix.readUInt32LE(12);
    if (!length || length > 64 * 1024 * 1024) throw new Error("Invalid ASAR header size");
    const header = Buffer.alloc(length);
    await file.read(header, 0, length, 16);
    const entries = [];
    const visit = (directory, parent = "") => {
      for (const [name, value] of Object.entries(directory.files ?? {})) {
        const entry = parent ? `${parent}/${name}` : name;
        if (value.link || value.unpacked) throw new Error(`Unverified packaged file: ${entry}`);
        if (value.files) visit(value, entry);
        else entries.push(entry);
      }
    };
    visit(JSON.parse(header.toString("utf8")));
    verifyEntries(entries);
  } finally {
    await file.close();
  }
}

/** Electron-owned resources are explicit; additions require review. */
export async function verifyResources(resources, mac) {
  const allowed = new Set([
    "app.asar",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
    ...(mac ? ["electron.icns"] : []),
  ]);
  await Promise.all(
    (await readdir(resources, { withFileTypes: true })).map(async (entry) => {
      if (entry.isFile() && allowed.has(entry.name)) return;
      if (
        mac &&
        entry.isDirectory() &&
        /^[a-z]{2,3}(?:_(?:[A-Z]{2}|[0-9]{3}))?\.lproj$/.test(entry.name) &&
        (await readdir(path.join(resources, entry.name))).length === 0
      )
        return;
      throw new Error(`Unexpected release resource: ${entry.name}`);
    }),
  );
}

export default async function verifyPackage(context) {
  const mac = context.electronPlatformName === "darwin";
  if (mac && context.packager.platformSpecificBuildOptions.notarize !== false) {
    requireNotarizationCredentials(process.env);
  }
  const resources = mac
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        "Contents",
        "Resources",
      )
    : path.join(context.appOutDir, "resources");
  // Local Electron distributions can retain the stock sample application.
  await rm(path.join(resources, "default_app.asar"), { force: true });
  await verifyResources(resources, mac);
  await verifyArchive(path.join(resources, "app.asar"));
}
