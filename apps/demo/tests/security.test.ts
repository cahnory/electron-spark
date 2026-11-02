import assert from "node:assert/strict";
import { join } from "node:path";
import { mock, test } from "node:test";

import type { Session } from "electron";

import { configureSessionPermissions } from "../src/main/core/security.ts";

void test("permissions deny by default and grants require a trusted main-frame origin", () => {
  let check!: NonNullable<Parameters<Session["setPermissionCheckHandler"]>[0]>;
  let request!: NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>;
  const session: Pick<Session, "setPermissionCheckHandler" | "setPermissionRequestHandler"> = {
    setPermissionCheckHandler(handler) {
      assert.ok(handler);
      check = handler;
    },
    setPermissionRequestHandler(handler) {
      assert.ok(handler);
      request = handler;
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
  configureSessionPermissions(session as Session);
  assert.equal(
    check(null, "notifications", "https://trusted.example", {
      isMainFrame: true,
      securityOrigin: "https://trusted.example",
    }),
    false,
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
  configureSessionPermissions(session as Session, [
    { origin: "https://trusted.example", permissions: ["notifications"] },
  ]);
  for (const [origin, isMainFrame, permission, expected] of [
    ["https://trusted.example/page", true, "notifications", true],
    ["https://evil.example", true, "notifications", false],
    ["https://trusted.example", false, "notifications", false],
    ["https://trusted.example", true, "media", false],
    ["file:///tmp/page.html", true, "notifications", false],
    ["invalid", true, "notifications", false],
  ] as const) {
    assert.equal(
      check(null, permission, origin, { isMainFrame, securityOrigin: origin }),
      expected,
    );
    request(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Partial Electron mock supplies only the members exercised by this test.
      null as unknown as Electron.WebContents,
      permission,
      (result) => assert.equal(result, expected),
      {
        requestingUrl: origin,
        mediaTypes: [],
        isMainFrame,
      },
    );
  }
});

void test("packaged apps cannot enable test mode through the environment", async () => {
  const app = { isPackaged: true };
  mock.module("electron", { namedExports: { app } });
  const previous = process.env.MODE;
  process.env.MODE = "test";
  try {
    const packaged: typeof import("../src/main/constants.ts") = await import(
      new URL("../src/main/constants.ts?packaged", import.meta.url).href
    );
    assert.equal(packaged.MODE, "production");
    assert.equal(packaged.RESOURCES_PATH, join(import.meta.dirname, "../src/main/resources"));
    app.isPackaged = false;
    assert.equal(
      (await import(new URL("../src/main/constants.ts?development", import.meta.url).href)).MODE,
      "test",
    );
  } finally {
    if (previous === undefined) delete process.env.MODE;
    else process.env.MODE = previous;
  }
});
