import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { build } from "vite";

import { externalDeps } from "../src/index.ts";

await test("externalizes runtime packages and subpaths while bundling dev dependencies and exclusions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "external-deps-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      type: "module",
      dependencies: { runtime: "1", bundled: "1" },
      optionalDependencies: { "@test/optional": "1" },
      devDependencies: { helper: "1" },
    }),
  );
  await Promise.all(
    ["bundled", "helper"].map(async (name) => {
      const dir = path.join(root, "node_modules", name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js" }));
      await writeFile(path.join(dir, "index.js"), `export default '${name}-content';`);
    }),
  );
  await writeFile(
    path.join(root, "entry.js"),
    `import a from 'runtime/subpath'; import b from '@test/optional/subpath'; import c from 'extra'; import d from 'bundled'; import e from 'helper'; console.log(a,b,c,d,e);`,
  );
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [externalDeps({ include: ["extra"], exclude: ["bundled"] })],
    resolve: { noExternal: true },
    build: { ssr: "entry.js" },
  });
  const code = await readFile(path.join(root, "dist/entry.js"), "utf8");
  for (const name of [
    "runtime/subpath",
    "@test/optional/subpath",
    "extra",
    "bundled-content",
    "helper-content",
  ])
    assert.ok(code.includes(name), name);
  assert.doesNotMatch(code, /from ["'](?:bundled|helper)["']/);
});
