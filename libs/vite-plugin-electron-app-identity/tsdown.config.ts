import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: true,
  },
  exports: {
    devExports: true,
  },
  format: ["cjs", "esm"],
  platform: "neutral",
} as const);
