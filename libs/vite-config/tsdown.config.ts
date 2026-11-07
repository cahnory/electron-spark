import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  copy: [{ from: "../vite-plugin-electron-renderer/window.schema.json", to: "." }],
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
