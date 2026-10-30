export { createFileSystemAdaptor } from "./adaptors/fileSystem";
export { createMemoryAdaptor } from "./adaptors/memory";
export { createStore, type StorageAdapter, type Store } from "./store";
export { ValidationError } from "./validator";
export {
  createVersionedStorage,
  UnsupportedVersionError,
  type StorageVersion,
  type VersionedData,
  type VersionedStorageOptions,
} from "./versionedStorage";
