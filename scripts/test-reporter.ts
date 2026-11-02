import { basename } from "node:path";
import { Readable } from "node:stream";
import { spec } from "node:test/reporters";
import type { TestEvent } from "node:test/reporters";

export default async function* report(source: AsyncIterable<TestEvent>) {
  const events: TestEvent[] = [];
  let summary: Extract<TestEvent, { type: "test:summary" }>["data"] | undefined;
  for await (const event of source) {
    events.push(event);
    if (event.type === "test:summary" && event.data.file === undefined) summary = event.data;
  }

  if (!summary?.success) {
    yield* Readable.from(events).pipe(spec());
    return;
  }

  const { passed, skipped, todo, cancelled } = summary.counts;
  const details = [`${passed} tests passed`];
  if (skipped) details.push(`${skipped} skipped`);
  if (todo) details.push(`${todo} todo`);
  if (cancelled) details.push(`${cancelled} cancelled`);
  yield `✓ ${basename(process.cwd())}: ${details.join(", ")}\n`;
}
