import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AfterPackContext } from "electron-builder";

import {
  afterPack,
  beforePack,
  afterSign,
  afterAllArtifactBuild,
} from "../scripts/release-hooks.ts";

void test("demo hooks retain the required main and renderer entries", async (t) => {
  assert.equal(typeof beforePack, "function");
  assert.equal(typeof afterSign, "function");
  assert.equal(typeof afterAllArtifactBuild, "function");
  const root = await mkdtemp(path.join(tmpdir(), "demo-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "resources"));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only these fields are read on Linux.
  const context = { electronPlatformName: "linux", appOutDir: root } as AfterPackContext;
  const writeArchive = async (includeView: boolean) => {
    const header = Buffer.from(
      JSON.stringify({
        files: {
          "package.json": {},
          dist: {
            files: {
              main: { files: { "index.js": {} } },
              ...(includeView ? { view: { files: { "index.html": {} } } } : {}),
            },
          },
        },
      }),
    );
    const prefix = Buffer.alloc(16);
    prefix.writeUInt32LE(header.length, 12);
    await writeFile(path.join(root, "resources/app.asar"), Buffer.concat([prefix, header]));
  };
  await writeArchive(true);
  await afterPack(context);
  await writeArchive(false);
  await assert.rejects(afterPack(context), /Missing packaged entry: dist\/view\/index.html/);
});
