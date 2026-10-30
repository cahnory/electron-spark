import type { StandardSchemaV1 } from "@standard-schema/spec";

export type Validator<Input, Output = Input> = StandardSchemaV1<Input, Output>;

type Validate = {
  <const Input, const Output>(schema: Validator<Input, Output>, value: Input): Promise<Output>;
  <const Type>(schema: undefined, value: Type): Promise<Type>;
  <const Input>(schema: Validator<Input, Input> | undefined, value: Input): Promise<Input>;
};

export const validate: Validate = async (
  schema: Validator<unknown, unknown> | undefined,
  value: unknown,
) => {
  if (!schema) {
    return value;
  }

  const result = await schema["~standard"].validate(value);

  if (result.issues) {
    throw new ValidationError(result.issues);
  }

  return result.value;
};

export class ValidationError extends Error {
  public override readonly name = "ValidationError";
  public readonly issues: readonly StandardSchemaV1.Issue[];

  public constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super("Validation failed");
    this.issues = issues;
  }
}
