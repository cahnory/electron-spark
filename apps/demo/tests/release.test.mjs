import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyEntries, requireNotarizationCredentials } from "../scripts/verify-package.mjs";

const required = ["package.json", "dist/main/index.js", "dist/view/index.html"];
const buildContext = (electronPlatformName, forceCodeSigning = true) => ({
  electronPlatformName,
  packager: { config: { forceCodeSigning } },
});

void test("release asset policy rejects dependency trees, source, credentials and maps", () => {
  assert.doesNotThrow(() =>
    verifyEntries([...required, "dist/preload/view/preload.cjs", "dist/assets/icon.png"]),
  );
  for (const file of [
    "node_modules/internal/src/index.js",
    "dist/main/index.js.map",
    "dist/source.ts",
    "dist/.env.production",
    "dist/private.pem",
    "dist/credentials.json",
    "dist/secrets/api.json",
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
  const { verifyResources } = await import("../scripts/verify-package.mjs");
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
  const { default: verifyBuildHost } = await import("../scripts/verify-build-host.mjs");
  for (const host of ["darwin", "linux"]) {
    assert.throws(() => verifyBuildHost(buildContext("win32"), host), /must be built on Windows/);
    assert.doesNotThrow(() => verifyBuildHost(buildContext("win32", false), host));
    assert.doesNotThrow(() => verifyBuildHost(buildContext("darwin"), host));
  }
  assert.doesNotThrow(() => verifyBuildHost(buildContext("win32"), "win32"));
});

void test("publisher requirements are passed to signature tools without shell interpolation", async () => {
  const { appleRequirement, verifyWindowsSignature } =
    await import("../scripts/verify-signature.mjs");
  assert.match(appleRequirement("ABC1234567"), /subject.OU.*ABC1234567/);
  assert.throws(() => appleRequirement('bad"identity'), /Invalid EXPECTED_APPLE_TEAM_ID/);
  verifyWindowsSignature("C:\\app's folder\\app.exe", (command, args, options) => {
    assert.equal(command, "powershell.exe");
    assert.equal(options.env.RELEASE_EXECUTABLE, "C:\\app's folder\\app.exe");
    assert.match(args.at(-1), /EXPECTED_WINDOWS_PUBLISHER/);
    assert.match(args.at(-1), /Status -ne 'Valid'/);
    assert.ok(!args.at(-1).includes("app's folder"));
  });
});
