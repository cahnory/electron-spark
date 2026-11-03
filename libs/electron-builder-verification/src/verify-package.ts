import { open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { AfterPackContext } from "electron-builder";

import { packagedDependencies, packageDirectory } from "./dependencies.ts";

interface ArchiveEntry {
  link?: string;
  unpacked?: boolean;
  files?: Record<string, ArchiveEntry>;
  offset?: string;
  size?: number;
}

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

export interface PackagePolicy {
  /** "auto" follows packaged production manifests; arrays explicitly allow package names. */
  dependencyPackages?: "auto" | readonly string[];
  /** Required paths inside app.asar. */
  requiredEntries?: readonly string[];
  /** Directory containing compiled assets. */
  outputDir?: string;
  /** Directory allowing additional resource formats. */
  resourcesDir?: string;
}

function dependencyFile(entry: string, policy: PackagePolicy): boolean {
  const parts = entry.split("/");
  let index = 0;
  while (parts[index] === "node_modules") {
    index++;
    const name = parts[index]?.startsWith("@")
      ? `${parts[index++]}/${parts[index++]}`
      : parts[index++];
    if (!name || !policy.dependencyPackages?.includes(name)) return false;
  }
  return index > 0 && index < parts.length && !parts.slice(index).includes("node_modules");
}

export function verifyEntries(entries: string[], policy: PackagePolicy = {}) {
  if (policy.dependencyPackages === "auto") {
    throw new Error('dependencyPackages: "auto" requires createPackageVerifier or verifyPackage');
  }
  const outputDir = policy.outputDir ?? "dist";
  const resourcesDir = policy.resourcesDir ?? `${outputDir}/main/resources`;
  for (const entry of entries) {
    const parts = entry.split("/");
    if (entry === "package.json") continue;
    if (
      (!entry.startsWith(`${outputDir}/`) && !dependencyFile(entry, policy)) ||
      parts.some(
        (part) =>
          !part ||
          part.startsWith(".") ||
          part.includes("\\") ||
          /^(?:secrets?|credentials?)(?:[.-]|$)/i.test(part),
      ) ||
      (!assetExtensions.has(path.posix.extname(entry).toLowerCase()) &&
        !(
          (entry.startsWith(`${resourcesDir}/`) || dependencyFile(entry, policy)) &&
          !/\.(?:[cm]?tsx?|map|pem|key|crt|p12|pfx)$/i.test(entry)
        ))
    ) {
      throw new Error(`Unexpected packaged file: ${entry}. Review the release asset policy.`);
    }
  }
  for (const name of policy.dependencyPackages ?? []) {
    if (!/^(@[a-z0-9_~-][a-z0-9._~-]*\/)?[a-z0-9_~-][a-z0-9._~-]*$/i.test(name)) {
      throw new Error(`Invalid dependency package name: ${name}`);
    }
    if (
      !entries.some(
        (entry) =>
          dependencyFile(entry, policy) && entry.endsWith(`node_modules/${name}/package.json`),
      )
    ) {
      throw new Error(`Missing packaged dependency: ${name}`);
    }
  }
  for (const required of ["package.json", ...(policy.requiredEntries ?? [])]) {
    if (!entries.includes(required)) throw new Error(`Missing packaged entry: ${required}`);
  }
}

export function requireNotarizationCredentials(env: NodeJS.ProcessEnv) {
  if (
    !(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) &&
    !(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) &&
    !env.APPLE_KEYCHAIN_PROFILE
  ) {
    throw new Error("Release packaging requires macOS notarization credentials. See README.md.");
  }
}

async function verifyArchive(archive: string, policy: PackagePolicy, mac: boolean) {
  const file = await open(archive, "r");
  try {
    // ASAR starts with a size pickle followed by a pickle containing JSON metadata.
    const prefix = Buffer.alloc(16);
    await file.read(prefix, 0, prefix.length, 0);
    const length = prefix.readUInt32LE(12);
    if (!length || length > 64 * 1024 * 1024) throw new Error("Invalid ASAR header size");
    const header = Buffer.alloc(length);
    await file.read(header, 0, length, 16);
    const entries: string[] = [];
    const unpacked: string[] = [];
    const metadata = new Map<string, ArchiveEntry>();
    const visit = (directory: ArchiveEntry, parent = "") => {
      for (const [name, value] of Object.entries(directory.files ?? {})) {
        const entry = parent ? `${parent}/${name}` : name;
        if (value.link) {
          throw new Error(`Unverified packaged file: ${entry}`);
        }
        if (value.files) visit(value, entry);
        else {
          entries.push(entry);
          metadata.set(entry, value);
          if (value.unpacked) unpacked.push(entry);
        }
      }
    };
    visit(JSON.parse(header.toString("utf8")));
    const automatic = policy.dependencyPackages === "auto";
    const resolvedPolicy = automatic
      ? {
          ...policy,
          dependencyPackages: [
            ...new Set(
              entries.flatMap((entry) => {
                const directory = packageDirectory(entry);
                return directory ? [directory.split("node_modules/").at(-1)!] : [];
              }),
            ),
          ],
        }
      : policy;
    for (const entry of unpacked) {
      if (!dependencyFile(entry, resolvedPolicy))
        throw new Error(`Unverified packaged file: ${entry}`);
    }
    verifyEntries(entries, resolvedPolicy);
    if (automatic) {
      // Validate unpacked paths before reading any manifests from the filesystem.
      await verifyResources(path.dirname(archive), mac, unpacked);
      const directories = await packagedDependencies(entries, async (entry) => {
        const info = metadata.get(entry);
        if (!info) throw new Error(`Missing packaged entry: ${entry}`);
        if (info.unpacked)
          return JSON.parse(await readFile(path.join(`${archive}.unpacked`, entry), "utf8"));
        const offset = Number(info.offset);
        const size = info.size;
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          !Number.isSafeInteger(size) ||
          size! < 0 ||
          size! > 16 * 1024 * 1024
        ) {
          throw new Error(`Invalid packaged manifest metadata: ${entry}`);
        }
        const buffer = Buffer.alloc(size!);
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          8 + prefix.readUInt32LE(4) + offset,
        );
        if (bytesRead !== buffer.length) throw new Error(`Truncated packaged manifest: ${entry}`);
        return JSON.parse(buffer.toString("utf8"));
      });
      for (const entry of entries) {
        const directory = packageDirectory(entry);
        if (directory && !directories.has(directory))
          throw new Error(`Unexpected packaged dependency: ${directory}`);
      }
    }
    return unpacked;
  } finally {
    await file.close();
  }
}

/** Electron-owned resources are explicit; additions require review. */
export async function verifyResources(
  resources: string,
  mac: boolean,
  unpackedEntries: readonly string[] = [],
) {
  const remaining = new Set(unpackedEntries);
  const verifyUnpacked = async (directory: string, parent = ""): Promise<void> => {
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const relative = parent ? `${parent}/${entry.name}` : entry.name;
        if (
          entry.isDirectory() &&
          unpackedEntries.some((file) => file.startsWith(`${relative}/`))
        ) {
          await verifyUnpacked(path.join(directory, entry.name), relative);
        } else if (entry.isFile() && remaining.delete(relative)) {
          return;
        } else {
          throw new Error(`Unexpected unpacked file: ${relative}`);
        }
      }),
    );
  };
  const allowed = new Set([
    "app.asar",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
    ...(mac ? ["electron.icns", "icon.icns"] : []),
  ]);
  await Promise.all(
    (await readdir(resources, { withFileTypes: true })).map(async (entry) => {
      if (entry.isFile() && allowed.has(entry.name)) return;
      if (entry.isDirectory() && entry.name === "app.asar.unpacked" && unpackedEntries.length) {
        await verifyUnpacked(path.join(resources, entry.name));
        return;
      }
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
  if (remaining.size) throw new Error(`Missing unpacked file: ${[...remaining][0]}`);
}

export default async function verifyPackage(context: AfterPackContext, policy: PackagePolicy = {}) {
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
  const unpacked = await verifyArchive(path.join(resources, "app.asar"), policy, mac);
  await verifyResources(resources, mac, unpacked);
}

export function createPackageVerifier(policy: PackagePolicy = {}) {
  return (context: AfterPackContext) => verifyPackage(context, policy);
}
