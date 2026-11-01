/** Deliberately narrower than Electron structured clone: plain, acyclic data only. */
export type IpcData =
  | null
  | undefined
  | boolean
  | number
  | string
  | readonly IpcData[]
  | {
      readonly [key: string]: IpcData;
    };

export function assertIpcData(value: unknown): asserts value is IpcData {
  const ancestors = new Set<object>();
  const validated = new Set<object>();
  const visit = (item: unknown): void => {
    if (
      item === null ||
      item === undefined ||
      ["string", "boolean", "number"].includes(typeof item)
    )
      return;
    if (typeof item !== "object") throw new TypeError("IPC values must be plain data");
    if (ancestors.has(item)) throw new TypeError("IPC values must not contain cycles");
    if (validated.has(item)) return;
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("IPC values must be arrays or plain objects");
    }
    if (Object.getOwnPropertySymbols(item).length)
      throw new TypeError("IPC values must not contain symbols");
    ancestors.add(item);
    for (const child of Object.values(item)) visit(child);
    ancestors.delete(item);
    validated.add(item);
  };
  visit(value);
}
