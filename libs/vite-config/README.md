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
  preload(config, { view, mode }) {
    config.build ??= {};
    config.build.minify = mode === "production" && view !== "views/debug";
  },
});
```

`defineElectronConfig` returns a Vite config function. Discovery and customization
run when Vite evaluates it, with a fresh generated configuration each time.

- `main` and `renderer` customize their respective environments.
- `preload` customizes each view's aggregate preload independently.
- `vite` customizes the full configuration last, after all named overrides.

Each customization accepts a Vite options object or a synchronous callback.
Objects use Vite's `mergeConfig` semantics: nested options merge, arrays generally
append, and `null`/`undefined` do not clear defaults. Callbacks mutate the supplied
configuration in place; their return value is ignored. Use callbacks to replace
arrays or delete defaults. Callbacks receive Vite's `ConfigEnv` (`command`, `mode`,
etc.); preload callbacks also receive `view`, the view directory relative to `srcDir`.

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
| `preloadPatterns`      | `["preload/**/*.ts"]`     | Preload modules/globs relative to srcDir            |
| `htmlEntry`            | `index.html`              | HTML entry relative to each view directory          |
| `windowConfigPath`     | Renderer plugin default   | Window config relative to each HTML entry directory |
| `rendererManifestPath` | Renderer plugin default   | Generated module relative to main entry directory   |
| `debug`                | `false`                   | Print the final customized configuration            |

Exported types: `ElectronConfigOptions`, `ConfigOverride`, and `PreloadContext`.

## Import-based preloads

Put bridge modules in `src/preload` and import them from your views:

```ts
import { files } from "../preload/files";
// src/view/index.ts
import { settings } from "../preload/settings";
```

`preloadPatterns` classifies resolved source files; aliases and extensionless imports
work too. Use more specific patterns when the directory also contains private
helpers. Matching a pattern alone does not execute or expose a module: a view must
import it, directly or through its dependencies. Type-only imports do not load it.
No import restrictions are introduced by this configuration.

For each view, Vite collects the matching imports from its renderer graph and
builds one self-contained CommonJS preload. Shared dependencies initialize once
within that bundle. Each module's exports occupy a separate entry in the bridge,
keyed by its normalized path relative to `srcDir`, so export names can overlap.
Renderer imports read those bridged exports without executing the implementation.
The usual Electron contextBridge value constraints still apply.

Statically discoverable dynamic imports, including Vite-expanded import globs,
are collected too. Their preloads initialize before the document runs, even when
the renderer loads the corresponding route later. Runtime-computed paths that
Vite cannot resolve are not supported for preload discovery.

Remove `webPreferences.preload` from `window.json`: the generated renderer manifest
sets it to `dist/preload/<view>/index.cjs`. Views with no matching imports receive
an empty aggregate. Generated source entries live under
`node_modules/.electron-spark/preload` and are not application source.

During development, a watched renderer discovery build runs without writing assets
before the preload and main builds start. Adding or removing imports regenerates
the relevant aggregate; successful preload rebuilds fully reload the renderer.
Preload implementation changes also rebuild and reload. Normal renderer HMR remains
available. This adds a renderer build at startup to discover lazy dependencies
before the first document loads.

## Dependency policy

Views/renderers bundle browser-compatible dependencies. Each preload also bundles
its dependencies into a self-contained CommonJS file, with Electron and Node
built-ins left external. Bundling does not make unavailable Node APIs usable in a
sandboxed preload or renderer.

Main builds externalize packages declared in the application's `dependencies`
and `optionalDependencies`, including package subpaths. Other imports remain
bundled by default. Electron remains external regardless of its devDependency
status. Application source and relative imports are bundled.

Keep runtime packages in `dependencies`, including packages used by views and
preloads. Build tools, type packages, and Electron itself belong in
`devDependencies`. A package used in both main and renderer can be shipped both
as an external package and inside the renderer bundle. Packaging all production
dependencies can also include unused copies of renderer-only packages; optimize
that separately if needed.

The manifest is read from `projectDir`. Include external runtime dependencies in
packaged applications; native modules also need binaries compatible with Electron.
For workspace packages exposing TypeScript source, opt into bundling:

```ts
export default defineElectronConfig({
  externalDeps: {
    exclude: ["my-workspace-package"],
    include: ["additional-runtime-package"],
  },
});
```

Set `externalDeps: false` to restore bundling of dependencies. Existing explicit
Vite/Rolldown external settings still apply. Exclusions leave packages subject to
those settings.

Use `externalDeps: false` for applications that ship only bundled output. The demo
ships external main dependencies through electron-builder and explicitly excludes
workspace source packages from externalization so they remain bundled.

Main ESM chunks also receive module-local `require`, `__filename`, and `__dirname`
bindings. Set `esmShim: false` to disable them. Paths refer to emitted chunks;
this does not make bundled native loaders or package-relative assets portable.
The standalone `@electron-spark/vite-plugin-external-deps` and
`@electron-spark/vite-plugin-esm-shim` packages can be used in custom Vite configs.
