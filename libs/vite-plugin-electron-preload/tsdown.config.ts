import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/runtime/exposeToRenderer.ts", "src/runtime/getExposed.ts"],
  deps: {
    neverBundle: true,
  },
  exports: {
    devExports: true,
  },
  format: ["cjs", "esm"],
  platform: "neutral",
} as const);
