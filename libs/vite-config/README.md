# @electron-spark/vite-config

Shared Vite configuration for Electron main, renderer, and discovered preload builds.

Files in `srcDir/resources` are emitted unchanged to `outDir/main/resources`
in development and production. The main process can read them with
`path.join(import.meta.dirname, "resources", "data.bin")`. Changes trigger the
watched main build and restart Electron. This directory is denied by the dev
HTTP server and is separate from renderer `public` assets. Resource symlinks
are rejected. Include the emitted directory in your packager's file policy.

```ts
import { defineElectronConfig } from "@electron-spark/vite-config";

export default defineElectronConfig({
  srcDir: "src",
  outDir: "dist",
  vite: { server: { port: 5173 } },
  main: { build: { sourcemap: true } },
  renderer: { define: { __APP_NAME__: JSON.stringify("My app") } },
  preload(config, { entry, mode }) {
    config.build ??= {};
    config.build.minify = mode === "production" && !entry.endsWith("debug.ts");
  },
});
```

`defineElectronConfig` returns a Vite config function. Discovery and customization
run when Vite evaluates it, with a fresh generated configuration each time.

- `main` and `renderer` customize their respective environments.
- `preload` customizes each unique discovered preload independently.
- `vite` customizes the full configuration last, after all named overrides.

Each customization accepts a Vite options object or a synchronous callback.
Objects use Vite's `mergeConfig` semantics: nested options merge, arrays generally
append, and `null`/`undefined` do not clear defaults. Callbacks mutate the supplied
configuration in place; their return value is ignored. Use callbacks to replace
arrays or delete defaults. Callbacks receive Vite's `ConfigEnv` (`command`, `mode`,
etc.); preload callbacks also receive `entry`, relative to `srcDir`.

Use the factory options for paths and discovery so related outputs and plugins
stay consistent. Raw Vite overrides can change generated settings and are the
caller's responsibility.

| Option                 | Default                   | Meaning                                             |
| ---------------------- | ------------------------- | --------------------------------------------------- |
| `projectDir`           | Current working directory | Base for source and output paths                    |
| `srcDir`               | `src`                     | Source directory relative to projectDir             |
| `outDir`               | `dist`                    | Output directory relative to projectDir             |
| `mainEntry`            | `main/index.ts`           | Main entry relative to srcDir                       |
| `viewPatterns`         | `["view", "views/*"]`     | View directories/globs relative to srcDir           |
| `htmlEntry`            | `index.html`              | HTML entry relative to each view directory          |
| `windowConfigPath`     | Renderer plugin default   | Window config relative to each HTML entry directory |
| `rendererManifestPath` | Renderer plugin default   | Generated module relative to main entry directory   |
| `debug`                | `false`                   | Print the final customized configuration            |

Exported types: `ElectronConfigOptions`, `ConfigOverride`, and `PreloadContext`.
