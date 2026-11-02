import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { createFileSystemAdaptor } from "../src/adaptors/fileSystem.ts";

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), "store-file-system-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

void test("returns initial value for a missing file and persists replacements across instances", async (t) => {
  const directory = await fixture(t);
  const file = join(directory, "nested", "state.json");
  const adapter = createFileSystemAdaptor(file, { count: 0 });
  assert.deepEqual(await adapter.read(), { count: 0 });
  await adapter.write({ count: 1 });
  assert.deepEqual(await createFileSystemAdaptor(file, { count: 0 }).read(), { count: 1 });
  await adapter.write({ count: 2 });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { count: 2 });
  assert.deepEqual(await readdir(join(directory, "nested")), ["state.json"]);
});

void test("propagates malformed JSON and filesystem read errors", async (t) => {
  const directory = await fixture(t);
  const file = join(directory, "state.json");
  await writeFile(file, "invalid JSON");
  await assert.rejects(Promise.resolve(createFileSystemAdaptor(file, {}).read()), SyntaxError);
  await assert.rejects(Promise.resolve(createFileSystemAdaptor(directory, {}).read()));
});

void test("serialization failures preserve the existing value", async (t) => {
  const directory = await fixture(t);
  const file = join(directory, "state.json");
  const adapter = createFileSystemAdaptor<unknown>(file, null);
  await adapter.write({ count: 1 });
  await assert.rejects(Promise.resolve(adapter.write(undefined)), TypeError);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  await assert.rejects(Promise.resolve(adapter.write(circular)), TypeError);
  assert.deepEqual(await adapter.read(), { count: 1 });
  assert.deepEqual(await readdir(directory), ["state.json"]);
});

void test("cleans up temporary files when replacement fails", async (t) => {
  const directory = await fixture(t);
  const target = join(directory, "target");
  await mkdir(target);
  await assert.rejects(Promise.resolve(createFileSystemAdaptor(target, {}).write({ count: 1 })));
  assert.deepEqual(await readdir(directory), ["target"]);
});
