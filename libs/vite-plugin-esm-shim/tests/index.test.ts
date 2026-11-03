import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "vite";

import { esmShim } from "../src/index.ts";

for (const format of ["es", "cjs"] as const) {
  void test(`executes CommonJS bindings in ${format} with split chunks and sourcemaps`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "esm-shim-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "entry.js"),
      `#!/usr/bin/env node\nexport const local = __dirname; export const filename = __filename; export const sep = require('node:path').sep; export const other = () => import('./other.js');`,
    );
    await writeFile(
      path.join(root, "other.js"),
      `export const directory = __dirname; export const filename = __filename;`,
    );
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [esmShim()],
      environments: { ssr: { consumer: "server" } },
      build: {
        ssr: "entry.js",
        sourcemap: true,
        rolldownOptions: {
          output: { format, entryFileNames: format === "es" ? "entry.js" : "entry.cjs" },
        },
      },
    });
    const filename = await realpath(
      path.join(root, "dist", format === "es" ? "entry.js" : "entry.cjs"),
    );
    const code = await readFile(filename, "utf8");
    assert.ok(code.startsWith("#!/usr/bin/env node\n"));
    const map = JSON.parse(await readFile(`${filename}.map`, "utf8"));
    assert.ok(map.sources.some((source: string) => source.endsWith("entry.js")));
    assert.ok(map.mappings.length > 0);
    const result = await import(pathToFileURL(filename).href);
    assert.equal(result.local, path.dirname(filename));
    assert.equal(result.filename, filename);
    assert.equal(result.sep, path.sep);
    const other = await result.other();
    assert.equal(other.directory, path.dirname(other.filename));
  });
}

await test("preserves user bindings and avoids helper name collisions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "esm-shim-bindings-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "entry.js"),
    `const __dirname = 'custom'; const __filename = 'file'; const require = () => 'custom require'; const __electronSparkShim = 'helper'; export { __dirname, __filename, require, __electronSparkShim };`,
  );
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [esmShim()],
    build: { ssr: "entry.js" },
  });
  const result = await import(pathToFileURL(path.join(root, "dist/entry.js")).href);
  assert.equal(result["__dirname"], "custom");
  assert.equal(result["__filename"], "file");
  assert.equal(result.require(), "custom require");
});
