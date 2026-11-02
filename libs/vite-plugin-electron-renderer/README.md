# Electron renderer metadata

```ts
electronRenderer({
  electronEnvironment: "electron",
  rendererManifestPath: "renderers.generated.ts", // Relative to the Electron entry directory.
  windowConfigPath: "window.json", // Relative to each HTML entry directory.
});
```

Each generated renderer has a `url` during development or a `path` after building,
plus a `window` object suitable for `new BrowserWindow(entry.window)`:

```ts
{
  path: "/app/dist/view/index.html",
  window: {
    title: "Settings",
    icon: "/app/dist/assets/favicon-abc.ico",
    autoHideMenuBar: true,
    webPreferences: { preload: "/app/dist/preload/view/preload.cjs" }
  }
}
```

The generated module defaults to `renderers.generated.ts` beside the main entry.
`rendererManifestPath` can override this path, relative to the main entry directory.

The generated source stays identical across build and serve, server port changes,
and changes to emitted preload or icon hashes. It changes when renderer inputs
or window metadata change. The plugin substitutes `VITE_DEV_SERVER_URL` in the
Electron bundle (the resolved server URL in development, `undefined` in production)
and resolves emitted filesystem paths while bundling. A hashed preload rebuild
invalidates the watched main build by updating the manifest timestamp without
changing its contents. Import this module through the configured Electron build.

The exported type supports both modes regardless of when the file was generated.
Check `renderer.mode === "serve"` to access each renderer's `url`; the `else`
branch exposes its `path`. Renderer keys and window options retain their inferred types.

The title comes from the HTML `<title>`. The icon comes from `<link rel="icon">`
(including `shortcut icon`), falling back to `favicon.ico` in Vite's configured
public directory when no icon is declared. Icons must be local files. Relative
HTML icon references resolve beside the HTML; root-relative references use the
public directory first, then Vite's root. Build icons are emitted as assets and
remain valid when the output is relocated.

An optional `window.json` beside each HTML file supplies JSON-compatible
BrowserWindow options. These override the HTML defaults, including `title` and
`icon`. A JSON `icon` path resolves relative to that HTML directory. Other options
are passed through unchanged.

`webPreferences.preload` declares the source file to compile (for example
`"./bridge.ts"`), relative to the JSON file's directory. The JSON filename is
configurable through `windowConfigPath` in both the plugin and desktop config.
Omitting this property means the window has no preload, even if a source file
exists beside its HTML. Invalid or missing declared sources produce an error.

The exported `readRendererWindow(html, windowConfigPath)` helper returns the
resolved JSON `file`, its `window` options, and the absolute optional `preload`
source. The desktop config uses this helper to create one build environment per
unique source; windows can share a source or reference one in another directory.
The plugin matches that exact source to a server environment with one input,
then replaces the source path with the emitted preload path in the generated
module, preserving the remaining web preferences.

For editor completion and validation, point `$schema` at the plugin's
`window.schema.json` through a relative path to its installed package. Adjust
the path to match the location of your view. `$schema` is editor metadata and
is not passed to `BrowserWindow`.

```json
{
  "$schema": "../../../node_modules/@electron-spark/vite-plugin-electron-renderer/window.schema.json",
  "title": "Custom settings title",
  "width": 900,
  "autoHideMenuBar": true,
  "webPreferences": { "sandbox": true, "preload": "./preload.ts" }
}
```

HTML and ordinary window configuration changes regenerate the module during
development. Adding, removing, or changing a preload declaration automatically
restarts Vite internally so the configuration can recreate the preload environments.
There is no need to stop and rerun the terminal command.

For dynamic view discovery, use `discoverRendererHtml(root, viewPatterns, htmlEntry)`
inside the Vite config function to populate the client HTML inputs, and pass the
same `viewPatterns` and `htmlEntry` to `electronRenderer`. Patterns describe view
directories relative to Vite's root; `htmlEntry` defaults to `index.html`.
The desktop config already wires this up for `view` and `views/*`.
Creating, removing, or renaming a matching HTML entry or its directory then
automatically reloads the configuration, including its preload environments.
Zero matching views are supported during development. Events are debounced to
group directory operations, and files outside the patterns do not cause a restart.

Adding or removing `window.json` (including a custom nested `windowConfigPath`)
is also watched. Creating an undeclared preload file does not attach it to a view:
declare it in `webPreferences.preload`. Removing a still-declared preload reports
an error and keeps the last valid manifest; restoring the file or correcting the
declaration is picked up automatically. The discovery watcher also tracks missing
declared sources, so the declaration and source can be created in either order.
