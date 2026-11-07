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
    webPreferences: { preload: "/app/dist/preload/view/index.cjs" }
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
BrowserWindow presentation options. These override the HTML defaults, including `title` and
`icon`. A JSON `icon` path resolves relative to that HTML directory. Other options
are passed through unchanged. `webPreferences` is rejected: configure execution
settings such as sandboxing, isolation, sessions, and process arguments in main.

With `defineElectronConfig`, preload modules are selected by `preloadPatterns` and
renderer imports. Each view receives one generated aggregate preload. Do not declare
`webPreferences` in `window.json`; the generated manifest supplies only the
emitted preload path.

Apply application execution settings when creating the window in main:

```ts
const options = entry.window;
const win = new BrowserWindow({
  ...options,
  webPreferences: {
    ...options.webPreferences,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  },
});
```

For custom Vite configurations, `preloadEnvironments` maps root-relative HTML
entries to the environments that build their aggregate preloads:

```ts
electronRenderer({
  electronEnvironment: "electron",
  preloadEnvironments: { "views/settings/index.html": "settingsPreload" },
});
```

Entries without a mapping have no preload. Each mapped environment must have one input and emit one entry. Build renderer
graphs first, followed by their aggregates, then main. The plugin handles this
ordering through `buildApp`; pair it with `electronPreloadViews` for discovery.

For editor completion and validation, point `$schema` at the plugin's
`window.schema.json` through a relative path to its installed package. Adjust
the path to match the location of your view. `$schema` is editor metadata and
is not passed to `BrowserWindow`.

```json
{
  "$schema": "../../../node_modules/@electron-spark/vite-plugin-electron-renderer/window.schema.json",
  "title": "Custom settings title",
  "width": 900,
  "autoHideMenuBar": true
}
```

HTML and ordinary window configuration changes regenerate the module during
development. Changes to imported preload modules are handled by the preload
plugin, which rebuilds the aggregate and reloads the document.

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
is also watched. A preload file becomes part of a view's aggregate only when it
matches the configured preload patterns and is imported by that view's graph.
