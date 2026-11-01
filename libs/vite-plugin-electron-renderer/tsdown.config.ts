import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: true,
  },
  exports: {
    devExports: true,
    customExports: { "./window.schema.json": "./window.schema.json" },
  },
  format: ["cjs", "esm"],
  platform: "neutral",
} as const);
