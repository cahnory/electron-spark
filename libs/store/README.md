# @electron-start/store

Async stores with serialized reads and mutations, optional Standard Schema
validation, and interchangeable storage adapters.

```ts
import { createMemoryAdaptor, createStore } from "@electron-start/store";

const store = createStore({ storage: createMemoryAdaptor({ count: 0 }) });
await store.update(({ count }) => ({ count: count + 1 }));
const value = await store.get();
```

`createFileSystemAdaptor(filePath, initialValue)` persists JSON-compatible values.
A missing file returns the initial value without creating a file. Writes create
parent directories and replace the file atomically. Invalid JSON and filesystem
errors propagate to the caller. Existing payloads are not schema-validated.

## Versioned storage

`createVersionedStorage` wraps an adapter containing `{ version, data }` and
exposes plain data to `createStore`. Adapters remain responsible for persistence.

```ts
import {
  createFileSystemAdaptor,
  createStore,
  createVersionedStorage,
  UnsupportedVersionError,
} from "@electron-start/store";
import { z } from "zod";

const settingsSchema = z.object({ enabled: z.boolean() });
type Settings = z.infer<typeof settingsSchema>;
const version = 2;
const initialValue: Settings = { enabled: false };

const storage = createVersionedStorage({
  storage: createFileSystemAdaptor("./data/settings.json", {
    version,
    data: initialValue,
  }),
  version,
  migrate: (stored): Settings => {
    if (
      stored.version === 1 &&
      typeof stored.data === "object" &&
      stored.data !== null &&
      "active" in stored.data &&
      typeof stored.data.active === "boolean"
    ) {
      return { enabled: stored.data.active };
    }

    throw new UnsupportedVersionError(stored.version, version);
  },
});

// Validate the unknown payload with a Standard Schema validator.
const store = createStore({ storage, validator: settingsSchema });
const settings = await store.get();
await store.update((current) => ({ enabled: !current.enabled }));
```

Versions are strings or finite numbers, compared by strict equality: `2` and
`"2"` are different versions. Matching versions return `data` directly. Other
versions call the optional `migrate` callback, which receives
`VersionedData<unknown>` and returns the current data, synchronously or
asynchronously. The callback can compose several migration steps. Without a
callback, a version mismatch throws `UnsupportedVersionError`.

Malformed envelopes throw `TypeError`. Migration and adapter errors propagate;
there is no automatic reset to the initial value. The initial envelope should
use the current version so missing files can return the current defaults.

Reads do not write migrated results back. The next successful `set` or `update`
writes `{ version: currentVersion, data }`. Migrations should avoid mutating their
input, especially with the memory adapter, which stores object references.

Envelope checks validate the version and presence of `data`. Versioned storage
returns payloads as `unknown`, including migration results, without validating
their shape. Filesystem reads also return `unknown`; memory reads retain their
known type.

The store's optional Standard Schema `validator` validates writes and reads,
including reads before an `update` callback. Invalid values throw `ValidationError`
without writing to storage. Sync and async validators are supported, and their
output is used. The same schema describes the persisted data for both reads and
writes (`Validator<T, T>`). Transformations must preserve that type and produce
values accepted by the same schema. Convert other input shapes before calling
`set` or returning from an `update` callback.
Without validation, a store preserves the adapter's read type, so untrusted reads
remain `unknown`.

Run the adapter and versioning tests with Node.js 24 or later:

```sh
node --test libs/store/tests/*.test.mjs
```
