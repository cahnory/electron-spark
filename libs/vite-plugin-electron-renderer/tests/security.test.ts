import assert from "node:assert/strict";
import { test } from "node:test";

void test("production CSP supplies a default and rejects executable remote or inline scripts", async () => {
  const { productionCsp } = await import("../src/csp.ts");
  const content = productionCsp("<html><head></head></html>")[0].attrs?.content;
  assert.equal(typeof content, "string");
  assert.match(String(content), /script-src 'self'/);
  for (const scripts of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"]) {
    assert.throws(
      () =>
        productionCsp(
          `<meta http-equiv="Content-Security-Policy" content="script-src ${scripts}; object-src 'none'; base-uri 'none'">`,
        ),
      /Production renderer CSP/,
    );
  }
  assert.throws(
    () => productionCsp(`<meta http-equiv="Content-Security-Policy" content="script-src 'self'">`),
    /Production renderer CSP/,
  );
  assert.doesNotThrow(() =>
    productionCsp(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'; base-uri 'none'; connect-src https://api.example">`,
    ),
  );
});
