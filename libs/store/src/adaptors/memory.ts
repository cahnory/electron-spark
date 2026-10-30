import type { StorageAdapter } from "../store";

export const createMemoryAdaptor = <T>(init: T): StorageAdapter<T> => {
  let value: T = init;

  return {
    read: () => value,
    write: (next: T) => {
      value = next;
    },
  };
};
