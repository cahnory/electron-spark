import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  createIpcApiBridge,
  createIpcApiClient,
  createIpcApiServer,
  createIpcState,
  defineIpcAction,
  type IpcRendererTransport,
} from "../src/index.ts";

declare const renderer: IpcRendererTransport;
declare const params: StandardSchemaV1<[left: number, right: number]>;
declare const empty: StandardSchemaV1<[]>;
declare const number: StandardSchemaV1<number>;
const actions = {
  sum: defineIpcAction({ params, handler: (left, right) => left + right }),
  asyncSum: defineIpcAction({ params, handler: async (left, right) => left + right }),
  empty: defineIpcAction({ params: empty, handler: () => undefined }),
};
const client = createIpcApiBridge<typeof actions>(renderer, "math", {
  sum: true,
  asyncSum: true,
  empty: true,
});
const sync: Promise<number> = client.sum(1, 2);
const async: Promise<number> = client.asyncSum(1, 2);
const nothing: Promise<undefined> = client.empty();
void [sync, async, nothing];
// @ts-expect-error wrong argument type
void client.sum("1", 2);
// @ts-expect-error wrong arity
void client.sum(1);
// @ts-expect-error unknown action
void client.missing();
// @ts-expect-error incomplete runtime allowlist
createIpcApiBridge<typeof actions>(renderer, "math", { sum: true });
// @ts-expect-error authorization must be explicit
createIpcApiServer("math", actions, {});
// @ts-expect-error unsupported result
defineIpcAction({ params: empty, handler: () => new Date() });
// @ts-expect-error input must be an argument tuple
defineIpcAction({ params: number, handler: (value: number) => value });

declare const transformed: StandardSchemaV1<[string], [number]>;
const transform = defineIpcAction({ params: transformed, handler: (value) => value + 1 });
const transformedClient = createIpcApiBridge<{ transform: typeof transform }>(
  renderer,
  "transform",
  { transform: true },
);
const transformedResult: Promise<number> = transformedClient.transform("1");
void transformedResult;
// @ts-expect-error renderer uses schema input, handler uses schema output
void transformedClient.transform(1);
const state = await createIpcState("count", {
  initialState: 0,
  schema: number,
  authorize: () => true,
});
const count: number = state.getState();
void count;
// @ts-expect-error state type follows schema
void state.setState("wrong");

const facade = createIpcApiClient(client);
const facadeResult: Promise<number> = facade.sum(1, 2);
void facadeResult;
// @ts-expect-error identity facade preserves the argument types
void facade.sum("bad", 2);

const commands = {
  sync: defineIpcAction({ params: empty, handler: () => {} }),
  async: defineIpcAction({ params: empty, handler: async () => {} }),
  conditional: defineIpcAction({
    params,
    handler: (left, right): number | void => {
      if (left > 0) return left + right;
    },
  }),
};
createIpcApiServer("commands", commands, { authorize: () => true });
const commandClient = createIpcApiBridge<typeof commands>(renderer, "commands", {
  sync: true,
  async: true,
  conditional: true,
});
const syncCommand: Promise<undefined> = commandClient.sync();
const asyncCommand: Promise<undefined> = commandClient.async();
const conditionalCommand: Promise<number | undefined> = commandClient.conditional(1, 2);
void [syncCommand, asyncCommand, conditionalCommand];

// New entry points preserve inference without pulling main implementation into preload.
import { createIpcRendererServer, getIpcContext } from "../src/main.ts";
import { createIpcStateBridge, createIpcEventBridge } from "../src/renderer.ts";
declare const backingSchema: StandardSchemaV1<{ count: number; secret: string }>;
const projected = await createIpcState("projected", {
  initialState: { count: 0, secret: "private" },
  schema: backingSchema,
  authorize: () => true,
  select: (data, { frame }) => ({ count: data.count, frame: frame.routingId }),
});
await projected.setState((current) => ({ ...current, count: current.count + 1 }), 0);
// @ts-expect-error functional updates must preserve the backing state type
void projected.setState(() => "bad");
const projectedBridge = createIpcStateBridge<{ count: number; frame: number }>(
  renderer,
  "projected",
);
const status: "idle" | "connecting" | "connected" | "disconnected" | "disposed" =
  projectedBridge.getStatus();
void status;
const reverse = createIpcRendererServer<Pick<typeof actions, "sum">>(
  "reverse",
  { sum: true },
  {
    authorize: () => true,
    results: { sum: number },
  },
);
const context = getIpcContext();
const reverseResult: Promise<number> = reverse
  .client({ sender: context.sender, senderFrame: context.frame })
  .sum(1, 2);
void reverseResult;
createIpcRendererServer<Pick<typeof actions, "sum">>(
  "reverse",
  { sum: true },
  // @ts-expect-error main must validate every reverse result
  { authorize: () => true, results: {} },
);
const eventBridge = createIpcEventBridge(renderer, "numbers", number);
eventBridge.subscribe(
  (value) => {
    const typed: number = value;
    void typed;
  },
  () => {},
);

const persisted = await createIpcState("persistent-count", {
  storage: {
    read: (): unknown => 0,
    write: (value: number) => {
      void value;
    },
  },
  schema: number,
  authorize: () => true,
});
const persistedCount: number = persisted.getState();
void persistedCount;
// @ts-expect-error persisted updates follow the schema type
void persisted.setState("wrong");
// @ts-expect-error exactly one initial source is required
void createIpcState("missing-source", { schema: number, authorize: () => true });
// @ts-expect-error storage provides initialization instead of initialState
void createIpcState("duplicate-source", {
  initialState: 0,
  storage: { read: () => 0, write: () => {} },
  schema: number,
  authorize: () => true,
});
