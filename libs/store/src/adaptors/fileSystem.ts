import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { StorageAdapter } from "../store";

/** Stores JSON-compatible values. Existing file contents are not validated. */
export const createFileSystemAdaptor = <T>(filePath: string, init: T): StorageAdapter<T> => {
  const file = resolve(filePath);

  return {
    read: async () => {
      let contents: string;

      try {
        contents = await readFile(file, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return init;
        }

        throw error;
      }

      return JSON.parse(contents) as T;
    },
    write: async (value: T) => {
      const contents = JSON.stringify(value);

      if (contents === undefined) {
        throw new TypeError("Store value cannot be serialized as JSON");
      }

      await mkdir(dirname(file), { recursive: true });

      const temporaryFile = `${file}.${randomUUID()}.tmp`;

      try {
        await writeFile(temporaryFile, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporaryFile, file);
      } finally {
        await rm(temporaryFile, { force: true });
      }
    },
  };
};
