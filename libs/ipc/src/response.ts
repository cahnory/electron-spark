import { assertIpcData, type IpcData } from "./data.ts";

export type IpcApiError = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};
export type IpcApiResponse<T extends IpcData = IpcData> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: IpcApiError };

export function errorResponse(error: unknown, includeStack = false): IpcApiResponse<never> {
  let message = "Unknown error";
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    /* unprintable value */
  }
  return {
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message,
      ...(includeStack && error instanceof Error && typeof error.stack === "string"
        ? { stack: error.stack }
        : {}),
    },
  };
}

export function readResponse(response: unknown): IpcData {
  if (response === null || typeof response !== "object" || !("ok" in response)) {
    throw new Error("Invalid IPC response");
  }
  if (response.ok === true && "data" in response && Object.hasOwn(response, "data")) {
    const data = response.data;
    assertIpcData(data);
    return data;
  }
  if (response.ok === false && "error" in response) {
    const detail = response.error;
    if (
      detail !== null &&
      typeof detail === "object" &&
      "name" in detail &&
      typeof detail.name === "string" &&
      "message" in detail &&
      typeof detail.message === "string" &&
      (!("stack" in detail) || detail.stack === undefined || typeof detail.stack === "string")
    ) {
      const error = new Error(detail.message);
      error.name = detail.name;
      if ("stack" in detail && typeof detail.stack === "string") error.stack = detail.stack;
      throw error;
    }
  }
  throw new Error("Invalid IPC response");
}
