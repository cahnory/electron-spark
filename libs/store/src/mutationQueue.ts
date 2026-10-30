export type MutationQueue = {
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
};

export const createMutationQueue = (): MutationQueue => {
  let pending: Promise<void> = Promise.resolve();

  return {
    enqueue: <const T>(operation: () => Promise<T>): Promise<T> => {
      const result = pending.then(operation);

      pending = result.then(
        (): void => undefined,
        (): void => undefined,
      );

      return result;
    },
  };
};
