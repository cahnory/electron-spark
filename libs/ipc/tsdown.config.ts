import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/main.ts", "src/renderer.ts"],
  deps: {
    neverBundle: true,
  },
  exports: {
    devExports: true,
  },
  format: ["cjs", "esm"],
  platform: "neutral",
} as const);
