import type { StorageAdapter } from "./store.ts";

export type StorageVersion = number | string;

export type VersionedData<T, Version extends StorageVersion = StorageVersion> = {
  version: Version;
  data: T;
};

export type VersionedStorageOptions<T, Version extends StorageVersion = StorageVersion> = {
  storage: {
    read: () => unknown;
    write: (value: VersionedData<T, Version>) => void | Promise<void>;
  };
  version: Version;
  migrate?: (stored: VersionedData<unknown>) => T | Promise<T>;
};

export class UnsupportedVersionError extends Error {
  public override readonly name = "UnsupportedVersionError";
  public readonly storedVersion: StorageVersion;
  public readonly currentVersion: StorageVersion;

  public constructor(storedVersion: StorageVersion, currentVersion: StorageVersion) {
    super(
      `Cannot migrate storage version ${JSON.stringify(storedVersion)} to ${JSON.stringify(currentVersion)}`,
    );
    this.storedVersion = storedVersion;
    this.currentVersion = currentVersion;
  }
}

const isVersion = (value: unknown): value is StorageVersion =>
  typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

/** Checks envelopes and migrates on read without validating payloads or persisting. */
export const createVersionedStorage = <T, Version extends StorageVersion = StorageVersion>({
  storage,
  version,
  migrate,
}: VersionedStorageOptions<T, Version>): StorageAdapter<T> => {
  if (!isVersion(version)) {
    throw new TypeError("Storage version must be a string or a finite number");
  }

  return {
    read: async () => {
      const stored = await storage.read();

      if (
        typeof stored !== "object" ||
        stored === null ||
        Array.isArray(stored) ||
        !Object.hasOwn(stored, "version") ||
        !("version" in stored) ||
        !isVersion(stored.version) ||
        !Object.hasOwn(stored, "data") ||
        !("data" in stored)
      ) {
        throw new TypeError("Invalid versioned storage envelope");
      }

      let data: unknown = stored.data;

      if (stored.version !== version) {
        if (!migrate) {
          throw new UnsupportedVersionError(stored.version, version);
        }

        data = await migrate({ version: stored.version, data: stored.data });
      }

      return data;
    },
    write: (data) => storage.write({ version, data }),
  };
};
