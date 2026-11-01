import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { configureSessionPermissions } from "../src/main/core/security.ts";

void test("permissions deny by default and grants require a trusted main-frame origin", () => {
  let check, request;
  const session = {
    setPermissionCheckHandler(handler) {
      check = handler;
    },
    setPermissionRequestHandler(handler) {
      request = handler;
    },
  };
  configureSessionPermissions(session);
  assert.equal(
    check(null, "notifications", "https://trusted.example", { isMainFrame: true }),
    false,
  );
  configureSessionPermissions(session, [
    { origin: "https://trusted.example", permissions: ["notifications"] },
  ]);
  for (const [origin, isMainFrame, permission, expected] of [
    ["https://trusted.example/page", true, "notifications", true],
    ["https://evil.example", true, "notifications", false],
    ["https://trusted.example", false, "notifications", false],
    ["https://trusted.example", true, "media", false],
    ["file:///tmp/page.html", true, "notifications", false],
    ["invalid", true, "notifications", false],
  ]) {
    assert.equal(check(null, permission, origin, { isMainFrame }), expected);
    request(null, permission, (result) => assert.equal(result, expected), {
      requestingUrl: origin,
      isMainFrame,
    });
  }
});

void test("packaged apps cannot enable test mode through the environment", async () => {
  const app = { isPackaged: true };
  mock.module("electron", { namedExports: { app } });
  const previous = process.env.MODE;
  process.env.MODE = "test";
  try {
    assert.equal((await import("../src/main/constants.ts?packaged")).MODE, "production");
    app.isPackaged = false;
    assert.equal((await import("../src/main/constants.ts?development")).MODE, "test");
  } finally {
    if (previous === undefined) delete process.env.MODE;
    else process.env.MODE = previous;
  }
});
