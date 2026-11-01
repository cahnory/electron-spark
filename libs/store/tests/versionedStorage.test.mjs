import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createFileSystemAdaptor } from "../src/adaptors/fileSystem.ts";
import { createMemoryAdaptor } from "../src/adaptors/memory.ts";
import { ValidationError } from "../src/validator.ts";
import { createVersionedStorage, UnsupportedVersionError } from "../src/versionedStorage.ts";

const countValidator = {
  "~standard": {
    version: 1,
    vendor: "store-test",
    validate: async (value) =>
      typeof value === "object" && value !== null && typeof value.count === "number"
        ? { value: { count: value.count } }
        : { issues: [{ message: "Expected a numeric count" }] },
  },
};

void test("validates current and migrated payloads and returns the validator result", async () => {
  await Promise.all(
    [1, 2].map(async (version) => {
      const original = { version, data: { count: 3, extra: true } };
      const adapter = createMemoryAdaptor(original);
      const storage = createVersionedStorage({
        storage: adapter,
        version: 2,
        migrate: (stored) => stored.data,
        validator: countValidator,
      });
      assert.deepEqual(await storage.read(), { count: 3 });
      assert.equal(adapter.read(), original);
    }),
  );
});

void test("rejects invalid current and migrated payloads without overwriting storage", async () => {
  await Promise.all(
    [1, 2].map(async (version) => {
      const original = { version, data: { count: "invalid" } };
      const adapter = createMemoryAdaptor(original);
      const storage = createVersionedStorage({
        storage: adapter,
        version: 2,
        migrate: (stored) => stored.data,
        validator: countValidator,
      });
      await assert.rejects(storage.read(), (error) => {
        assert.ok(error instanceof ValidationError);
        assert.deepEqual(error.issues, [{ message: "Expected a numeric count" }]);
        return true;
      });
      assert.equal(adapter.read(), original);
    }),
  );
});

void test("reads current data without migrating and wraps writes", async () => {
  const adapter = createMemoryAdaptor({ version: "v2", data: { count: 1 } });
  const storage = createVersionedStorage({
    storage: adapter,
    version: "v2",
    migrate: () => assert.fail("Current version must not be migrated"),
  });
  assert.deepEqual(await storage.read(), { count: 1 });
  await storage.write({ count: 2 });
  assert.deepEqual(adapter.read(), { version: "v2", data: { count: 2 } });
});

void test("migrates unknown data asynchronously without persisting until a write", async () => {
  const original = { version: 1, data: { oldCount: 3 } };
  const adapter = createMemoryAdaptor(original);
  const storage = createVersionedStorage({
    storage: adapter,
    version: 2,
    migrate: async (stored) => {
      assert.deepEqual(stored, original);
      return { count: stored.data.oldCount };
    },
  });
  assert.deepEqual(await storage.read(), { count: 3 });
  assert.equal(adapter.read(), original);
  await storage.write({ count: 4 });
  assert.deepEqual(adapter.read(), { version: 2, data: { count: 4 } });
});

void test("compares versions by strict equality and rejects unsupported versions", async () => {
  const storage = createVersionedStorage({
    storage: createMemoryAdaptor({ version: "2", data: 1 }),
    version: 2,
  });
  await assert.rejects(storage.read(), (error) => {
    assert.ok(error instanceof UnsupportedVersionError);
    assert.equal(error.storedVersion, "2");
    assert.equal(error.currentVersion, 2);
    return true;
  });
});

void test("rejects malformed envelopes without attempting migration", async () => {
  await Promise.all(
    [
      null,
      [],
      1,
      {},
      { version: 1 },
      { data: 1 },
      { version: null, data: 1 },
      { version: NaN, data: 1 },
      Object.create({ version: 1, data: 1 }),
    ].map(async (value) => {
      const storage = createVersionedStorage({
        storage: createMemoryAdaptor(value),
        version: 2,
        migrate: () => assert.fail("Malformed envelopes must not be migrated"),
      });
      await assert.rejects(storage.read(), TypeError);
    }),
  );
  for (const version of [NaN, Infinity, null]) {
    assert.throws(
      () => createVersionedStorage({ storage: createMemoryAdaptor(null), version }),
      TypeError,
    );
  }
});

void test("propagates migration and adapter errors without resetting data", async () => {
  const original = { version: 1, data: "old" };
  const adapter = createMemoryAdaptor(original);
  const error = new Error("Migration failed");
  await Promise.all(
    [
      () => {
        throw error;
      },
      async () => {
        throw error;
      },
    ].map(async (migrate) => {
      const storage = createVersionedStorage({ storage: adapter, version: 2, migrate });
      await assert.rejects(storage.read(), (caught) => caught === error);
      assert.equal(adapter.read(), original);
    }),
  );
  const storage = createVersionedStorage({
    storage: {
      read: async () => {
        throw error;
      },
      write: async () => {
        throw error;
      },
    },
    version: 2,
  });
  await assert.rejects(storage.read(), (caught) => caught === error);
  await assert.rejects(storage.write("new"), (caught) => caught === error);
});

void test("supports missing files with a current-version initial envelope", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "versioned-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const storage = createVersionedStorage({
    storage: createFileSystemAdaptor(file, { version: 2, data: { count: 0 } }),
    version: 2,
  });
  assert.deepEqual(await storage.read(), { count: 0 });
  await assert.rejects(readFile(file), { code: "ENOENT" });
  await storage.write({ count: 1 });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { version: 2, data: { count: 1 } });
});
