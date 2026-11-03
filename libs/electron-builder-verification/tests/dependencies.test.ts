import assert from "node:assert/strict";
import { test } from "node:test";

import { packagedDependencies, type DependencyManifest } from "../src/dependencies.ts";

function discover(manifests: Record<string, DependencyManifest>) {
  return packagedDependencies(Object.keys(manifests), async (entry) => manifests[entry]);
}

void test("follows nested, hoisted, scoped, peer and cyclic production dependencies", async () => {
  const manifests = {
    "package.json": {
      dependencies: { app: "1", shared: "1" },
      optionalDependencies: { absent: "1" },
    },
    "node_modules/app/package.json": {
      dependencies: { "@scope/native": "1", shared: "2" },
      peerDependencies: { peer: "1", optionalPeer: "1" },
      peerDependenciesMeta: { optionalPeer: { optional: true } },
    },
    "node_modules/app/node_modules/shared/package.json": {},
    "node_modules/shared/package.json": {},
    "node_modules/peer/package.json": {},
    "node_modules/@scope/native/package.json": { dependencies: { app: "1" } },
    "node_modules/unused/package.json": {},
  };
  assert.deepEqual(
    [...(await discover(manifests))].toSorted(),
    [
      "node_modules/app",
      "node_modules/app/node_modules/shared",
      "node_modules/shared",
      "node_modules/peer",
      "node_modules/@scope/native",
    ].toSorted(),
  );
});

void test("missing required packages fail even when an unreachable nested copy exists", async () => {
  await assert.rejects(
    discover({
      "package.json": { dependencies: { required: "1" } },
      "node_modules/other/node_modules/required/package.json": {},
    }),
    /Missing packaged dependency: required/,
  );
  await assert.rejects(
    discover({
      "package.json": { dependencies: { app: "1" } },
      "node_modules/app/package.json": { peerDependencies: { required: "1" } },
    }),
    /Missing packaged dependency: required/,
  );
});

void test("optional overrides may be absent and installed optional dependencies are followed", async () => {
  const directories = await discover({
    "package.json": {
      dependencies: { absent: "1" },
      optionalDependencies: { absent: "1", installed: "1" },
    },
    "node_modules/installed/package.json": {},
  });
  assert.deepEqual([...directories], ["node_modules/installed"]);
});
