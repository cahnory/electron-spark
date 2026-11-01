import type { StandardSchemaV1 } from "@standard-schema/spec";

import { assertIpcData, type IpcData } from "./data.ts";

export type IpcValidator<Input, Output = Input> = StandardSchemaV1<Input, Output>;
export class IpcValidationError extends Error {
  override readonly name = "IpcValidationError";
  readonly issues: readonly StandardSchemaV1.Issue[];
  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super("IPC validation failed");
    this.issues = issues;
  }
}
export async function validate<Input, Output>(
  schema: IpcValidator<Input, Output>,
  value: unknown,
): Promise<Output> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) throw new IpcValidationError(result.issues);
  return result.value;
}

export interface IpcAction<
  Params extends readonly IpcData[] = readonly IpcData[],
  Result extends IpcData | void = IpcData | void,
> {
  readonly types?: { readonly params: Params; readonly result: Result };
  readonly invoke: (args: readonly unknown[], beforeHandler?: () => void) => Promise<Result>;
}
export function defineIpcAction<
  Input extends readonly IpcData[],
  Params extends readonly IpcData[],
  Result extends IpcData | void,
>(options: {
  params: IpcValidator<Input, Params>;
  handler: (...params: Params) => Result | Promise<Result>;
  result?: IpcValidator<Result>;
}): IpcAction<Input, Result> {
  return {
    async invoke(args, beforeHandler) {
      assertIpcData(args);
      const params = await validate(options.params, args);
      beforeHandler?.();
      const result = await options.handler(...params);
      const data = options.result ? await validate(options.result, result) : result;
      assertIpcData(data);
      return data;
    },
  };
}
export type IpcActions = Readonly<Record<string, IpcAction>>;
export type IpcApiClient<Actions extends IpcActions> = {
  readonly [Key in keyof Actions]: Actions[Key] extends IpcAction<infer Params, infer Result>
    ? (...params: Params) => Promise<Result extends void ? undefined : Result>
    : never;
};
