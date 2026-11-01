import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { createIntl, createIntlCache } from "react-intl";

import { en } from "../src/view/messages/en.ts";
import { fr } from "../src/view/messages/fr.ts";

void test("English catalog IDs match the configured content hash", () => {
  for (const [id, message] of Object.entries(en)) {
    assert.equal(id, createHash("sha512").update(message).digest("base64").slice(0, 6));
  }
});

for (const [locale, messages] of Object.entries({ en, fr })) {
  void test(`${locale} messages are complete and format without ICU errors`, () => {
    assert.deepEqual(Object.keys(messages).toSorted(), Object.keys(en).toSorted());
    const intl = createIntl(
      {
        locale,
        messages,
        onError: (error) => {
          throw error;
        },
      },
      createIntlCache(),
    );
    for (const id of Object.keys(en)) {
      // Exercise catalog lookup without default-message fallback.
      const descriptor = { id };
      const formatted = intl.formatMessage(descriptor, {
        name: "TanStack Router",
        br: () => "\n",
        code: (chunks) => chunks.join(""),
      });
      assert.equal(typeof formatted, "string");
      assert.ok(formatted.length > 0);
      assert.notEqual(formatted, id);
    }
    assert.ok(
      intl
        .formatMessage(
          { id: "HaVVfJ", defaultMessage: "Edit <code>src/view</code> to change this screen." },
          { code: (chunks) => chunks.join("") },
        )
        .includes("src/view"),
    );
    assert.ok(
      intl
        .formatMessage(
          { id: "xj3azO", defaultMessage: "Explore {name} documentation" },
          { name: "TanStack Router" },
        )
        .includes("TanStack Router"),
    );
  });
}
