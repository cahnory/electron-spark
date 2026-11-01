export { createFileSystemAdaptor } from "./adaptors/fileSystem.ts";
export { createMemoryAdaptor } from "./adaptors/memory.ts";
export { createStore, type StorageAdapter, type Store } from "./store.ts";
export { ValidationError } from "./validator.ts";
export {
  createVersionedStorage,
  UnsupportedVersionError,
  type StorageVersion,
  type VersionedData,
  type VersionedStorageOptions,
} from "./versionedStorage.ts";
