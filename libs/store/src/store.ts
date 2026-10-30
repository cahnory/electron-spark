import { type MutationQueue, createMutationQueue } from "./mutationQueue";
import { type Validator, validate } from "./validator";

export type StorageAdapter<T> = {
  read: () => T | Promise<T>;
  write: (value: T) => void | Promise<void>;
};

export type Store<Input, Output = Input> = {
  get: () => Output | Promise<Output>;
  set: (value: Input) => Promise<void>;
  update: (transform: (current: Output) => Input | Promise<Input>) => Promise<void>;
};

type CreateStore = {
  <const Input, const Output>(opts: {
    queue?: MutationQueue;
    storage: StorageAdapter<Output>;
    validator: Validator<Input, Output>;
  }): Store<Input, Output>;
  <const Type>(opts: {
    queue?: MutationQueue;
    storage: StorageAdapter<Type>;
    validator?: undefined;
  }): Store<Type, Type>;
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
    get: () => queue.enqueue(() => Promise.resolve(storage.read())),
    set: (value) =>
      queue.enqueue(async () => {
        await storage.write(await validate(validator, value));
      }),
    update: (transform) =>
      queue.enqueue(async () => {
        const current = await storage.read();
        const next = await validate(validator, await transform(current));

        await storage.write(next);
      }),
  }) satisfies Store<unknown>;
