import assert from "node:assert/strict";
import { test } from "node:test";

import type { AfterPackContext } from "electron-builder";

import {
  verifyEntries as verifyPolicyEntries,
  requireNotarizationCredentials,
} from "../src/verify-package.ts";

const verifyEntries = (entries: string[]) =>
  verifyPolicyEntries(entries, { requiredEntries: ["dist/main/index.js", "dist/view/index.html"] });

const required = ["package.json", "dist/main/index.js", "dist/view/index.html"];
// The hook reads only platform and signing policy from the builder context.
const buildContext = (electronPlatformName: string, forceCodeSigning = true) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial builder context supplies exactly the fields this hook reads.
  ({
    electronPlatformName,
    packager: { config: { forceCodeSigning } },
  }) as AfterPackContext;

void test("release asset policy rejects dependency trees, source, credentials and maps", () => {
  assert.doesNotThrow(() =>
    verifyEntries([
      ...required,
      "dist/preload/view/preload.cjs",
      "dist/assets/icon.png",
      "dist/main/resources/data/example.bin",
      "dist/main/resources/README.md",
    ]),
  );
  for (const file of [
    "node_modules/internal/src/index.js",
    "dist/main/index.js.map",
    "dist/source.ts",
    "dist/.env.production",
    "dist/private.pem",
    "dist/credentials.json",
    "dist/secrets/api.json",
    "dist/assets/example.bin",
    "dist/main/resources/source.ts",
    "dist/main/resources/private.pem",
    "dist/main/resources/.env",
    "dist/main/resources/credentials.json",
  ]) {
    assert.throws(() => verifyEntries([...required, file]), /Unexpected packaged file/);
  }
  assert.throws(() => verifyEntries(["package.json"]), /Missing packaged entry/);
});

void test("macOS releases require a complete notarization credential set", () => {
  assert.throws(() => requireNotarizationCredentials({}), /notarization credentials/);
  assert.throws(
    () => requireNotarizationCredentials({ APPLE_ID: "developer" }),
    /notarization credentials/,
  );
  for (const env of [
    { APPLE_ID: "developer", APPLE_APP_SPECIFIC_PASSWORD: "password", APPLE_TEAM_ID: "team" },
    { APPLE_API_KEY: "key", APPLE_API_KEY_ID: "id", APPLE_API_ISSUER: "issuer" },
    { APPLE_KEYCHAIN_PROFILE: "release" },
  ])
    assert.doesNotThrow(() => requireNotarizationCredentials(env));
});

void test("resource policy rejects unexpected directories, files and symlinks", async (t) => {
  const { mkdtemp, writeFile, mkdir, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { verifyResources } = await import("../src/verify-package.ts");
  const root = await mkdtemp(path.join(tmpdir(), "release-resources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "app.asar"), "");
  await mkdir(path.join(root, "en.lproj"));
  await mkdir(path.join(root, "es_419.lproj"));
  await verifyResources(root, true);
  await writeFile(path.join(root, "es_419.lproj", "secret.json"), "{}");
  await assert.rejects(verifyResources(root, true), /Unexpected release resource: es_419.lproj/);
  await rm(path.join(root, "es_419.lproj"), { recursive: true });
  await writeFile(path.join(root, "en.lproj", "secret.json"), "{}");
  await assert.rejects(verifyResources(root, true), /Unexpected release resource/);
  await rm(path.join(root, "en.lproj"), { recursive: true });
  await writeFile(path.join(root, "extra.json"), "{}");
  await assert.rejects(verifyResources(root, true), /Unexpected release resource/);
  await rm(path.join(root, "extra.json"));
  await symlink(path.join(root, "app.asar"), path.join(root, "electron.icns"));
  await assert.rejects(verifyResources(root, true), /Unexpected release resource/);
});

void test("Windows releases require a Windows host before packaging", async () => {
  const { default: verifyBuildHost } = await import("../src/verify-build-host.ts");
  for (const host of ["darwin", "linux"] as const) {
    assert.throws(() => verifyBuildHost(buildContext("win32"), host), /must be built on Windows/);
    assert.doesNotThrow(() => verifyBuildHost(buildContext("win32", false), host));
    assert.doesNotThrow(() => verifyBuildHost(buildContext("darwin"), host));
  }
  assert.doesNotThrow(() => verifyBuildHost(buildContext("win32"), "win32"));
});

void test("publisher requirements are passed to signature tools without shell interpolation", async () => {
  const { appleRequirement, verifyWindowsSignature } = await import("../src/verify-signature.ts");
  assert.match(appleRequirement("ABC1234567"), /subject.OU.*ABC1234567/);
  assert.throws(() => appleRequirement('bad"identity'), /Invalid EXPECTED_APPLE_TEAM_ID/);
  verifyWindowsSignature("C:\\app's folder\\app.exe", (command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.equal(options.env?.RELEASE_EXECUTABLE, "C:\\app's folder\\app.exe");
    assert.match(args[args.length - 1], /EXPECTED_WINDOWS_PUBLISHER/);
    assert.match(args[args.length - 1], /Status -ne 'Valid'/);
    assert.ok(!args[args.length - 1].includes("app's folder"));
  });
});

void test("asset policy supports other app layouts without permitting source or traversal", () => {
  const policy = {
    outputDir: "build/client",
    resourcesDir: "build/client/data",
    requiredEntries: ["build/client/main.cjs", "build/client/windows/settings.html"],
  };
  const entries = ["package.json", ...policy.requiredEntries, "build/client/data/model.bin"];
  assert.doesNotThrow(() => verifyPolicyEntries(entries, policy));
  assert.throws(() => verifyPolicyEntries(entries.slice(0, 2), policy), /Missing packaged entry/);
  for (const entry of [
    "dist/main/index.js",
    "build/client/data/source.ts",
    "build/client/../secret.json",
    "build/client/a\\b.json",
  ]) {
    assert.throws(
      () => verifyPolicyEntries([...entries, entry], policy),
      /Unexpected packaged file/,
    );
  }
});

void test("dependency policy permits reviewed packages and rejects unexpected or unsafe files", () => {
  const policy = { dependencyPackages: ["zod", "@test/native", "helper"] };
  const entries = [
    ...required,
    "node_modules/zod/package.json",
    "node_modules/zod/v4/index.cjs",
    "node_modules/zod/LICENSE",
    "node_modules/@test/native/package.json",
    "node_modules/@test/native/build/addon.node",
    "node_modules/@test/native/node_modules/helper/package.json",
    "node_modules/@test/native/node_modules/helper/data.bin",
  ];
  assert.doesNotThrow(() => verifyPolicyEntries(entries, policy));
  assert.throws(() => verifyPolicyEntries(required, policy), /Missing packaged dependency/);
  assert.throws(
    () => verifyPolicyEntries([...required, "dist/node_modules/zod/package.json"], policy),
    /Missing packaged dependency/,
  );
  for (const file of [
    "node_modules/other/index.js",
    "node_modules/zod/node_modules/other/index.js",
    "node_modules/zod/../other/index.js",
    "node_modules/zod/.env",
    "node_modules/zod/private.pem",
    "node_modules/zod/source.ts",
    "node_modules/zod/index.d.cts",
    "node_modules/zod/index.js.map",
    "node_modules/zod/credentials.json",
    "node_modules/zod/lib/node_modules/other/index.js",
  ]) {
    assert.throws(
      () => verifyPolicyEntries([...entries, file], policy),
      /Unexpected packaged file/,
    );
  }
});

void test("unpacked dependencies must match archive entries and cannot contain symlinks", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm, symlink } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { verifyResources } = await import("../src/verify-package.ts");
  const root = await mkdtemp(path.join(tmpdir(), "unpacked-dependencies-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "app.asar"), "");
  const directory = path.join(root, "app.asar.unpacked/node_modules/native");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "addon.node");
  const entries = ["node_modules/native/addon.node"];
  await assert.rejects(verifyResources(root, false, entries), /Missing unpacked file/);
  await writeFile(file, "native binary");
  await verifyResources(root, false, entries);
  await assert.rejects(verifyResources(root, false), /Unexpected release resource/);
  await writeFile(path.join(directory, "extra.json"), "{}");
  await assert.rejects(verifyResources(root, false, entries), /Unexpected unpacked file/);
  await rm(path.join(directory, "extra.json"));
  await rm(file);
  await symlink(path.join(root, "app.asar"), file);
  await assert.rejects(verifyResources(root, false, entries), /Unexpected unpacked file/);
});

void test("package verifier checks unpacked dependencies against ASAR metadata", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createPackageVerifier } = await import("../src/verify-package.ts");
  const root = await mkdtemp(path.join(tmpdir(), "dependency-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = path.join(root, "resources");
  const native = path.join(resources, "app.asar.unpacked/node_modules/native");
  await mkdir(native, { recursive: true });
  await writeFile(path.join(native, "addon.node"), "native binary");
  await writeFile(path.join(native, "package.json"), "{}");
  const manifest = Buffer.from(JSON.stringify({ dependencies: { native: "1" } }));
  const header = Buffer.from(
    JSON.stringify({
      files: {
        "package.json": { offset: "0", size: manifest.length },
        node_modules: {
          files: {
            native: {
              unpacked: true,
              files: {
                "package.json": { unpacked: true },
                "addon.node": { unpacked: true },
              },
            },
          },
        },
      },
    }),
  );
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(8 + header.length, 4);
  prefix.writeUInt32LE(header.length, 12);
  await writeFile(path.join(resources, "app.asar"), Buffer.concat([prefix, header, manifest]));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Linux verification only reads these fields.
  const context = { electronPlatformName: "linux", appOutDir: root } as AfterPackContext;
  const verify = createPackageVerifier({ dependencyPackages: ["native"] });
  await verify(context);
  await createPackageVerifier({ dependencyPackages: "auto" })(context);
  await assert.rejects(createPackageVerifier()(context), /Unverified packaged file/);
  await rm(path.join(native, "addon.node"));
  await assert.rejects(verify(context), /Missing unpacked file/);
});
