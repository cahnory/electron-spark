import assert from "node:assert/strict";
import { test } from "node:test";

import { createIntl, createIntlCache } from "react-intl";

import { en } from "./src/view/messages/en.ts";
import { fr } from "./src/view/messages/fr.ts";

for (const [locale, messages] of Object.entries({ en, fr })) {
  void test(`${locale} messages are complete and format without ICU errors`, () => {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort());
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
      const formatted = intl.formatMessage(
        { id },
        {
          name: "TanStack Router",
          br: () => "\n",
          code: (chunks) => chunks.join(""),
        },
      );
      assert.equal(typeof formatted, "string");
      assert.ok(formatted.length > 0);
      assert.notEqual(formatted, id);
    }
    assert.ok(
      intl
        .formatMessage({ id: "home.start.description" }, { code: (chunks) => chunks.join("") })
        .includes("src/view"),
    );
    assert.ok(
      intl
        .formatMessage({ id: "home.docs.label" }, { name: "TanStack Router" })
        .includes("TanStack Router"),
    );
  });
}
