import { type MutationQueue, createMutationQueue } from "./mutationQueue.ts";
import { type Validator, validate } from "./validator.ts";

export type StorageAdapter<T, Read = unknown> = {
  read: () => Read | Promise<Read>;
  write: (value: T) => void | Promise<void>;
};

export type Store<Input, Output = Input> = {
  get: () => Output | Promise<Output>;
  set: (value: Input) => Promise<void>;
  update: (transform: (current: Output) => Input | Promise<Input>) => Promise<void>;
};

type CreateStore = {
  <const Type>(opts: {
    queue?: MutationQueue;
    storage: StorageAdapter<Type>;
    validator: Validator<Type, Type>;
  }): Store<Type>;
  <const Type, const Read>(opts: {
    queue?: MutationQueue;
    storage: StorageAdapter<Type, Read>;
    validator?: undefined;
  }): Store<Type, Read>;
};

export const createStore: CreateStore = ({
  queue = createMutationQueue(),
  storage,
  validator,
}: {
  queue?: MutationQueue;
  storage: StorageAdapter<unknown>;
  validator?: Validator<unknown, unknown> | undefined;
}) =>
  ({
    get: () => queue.enqueue(async () => validate(validator, await storage.read())),
    set: (value) =>
      queue.enqueue(async () => {
        await storage.write(await validate(validator, value));
      }),
    update: (transform) =>
      queue.enqueue(async () => {
        const current = await validate(validator, await storage.read());
        const next = await validate(validator, await transform(current));

        await storage.write(next);
      }),
  }) satisfies Store<unknown>;
