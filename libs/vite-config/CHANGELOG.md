# @electron-spark/vite-config

## 0.3.0

### Minor Changes

- 19f552c: Discover preload modules from renderer imports using `preloadPatterns` (default:
  `preload/**/*.ts`) and build one aggregate CommonJS preload per view. Module exports
  are namespaced by source path, allowing multiple preloads with overlapping export
  names and deduplicated shared dependencies. Development discovers the renderer
  graph before launch and rebuilds aggregates when imports change.

  Window JSON now accepts presentation options only and rejects `webPreferences`.
  Configure execution settings in main; preload paths come from generated aggregates.
  The renderer plugin no longer supports manual preload declarations in window JSON.
  Preload override callbacks now receive `view` instead of `entry`. The runtime
  `exposeToRenderer` helper accepts the complete module registry. Custom configurations
  can use `electronPreloadViews` with the renderer plugin's `preloadEnvironments` map.

### Patch Changes

- e0fb454: Include and export `window.schema.json` so applications can validate window options
  without depending directly on the renderer plugin.
- Updated dependencies [19f552c]
  - @electron-spark/vite-plugin-electron-preload@0.2.0
  - @electron-spark/vite-plugin-electron-renderer@0.2.0

## 0.2.0

### Minor Changes

- e742b07: Add standalone server-environment plugins for production dependency externalization and Node ESM compatibility bindings. Enable both for Electron main builds, preserving package layouts for native libraries while bundling development dependencies. Support explicit dependency inclusions/exclusions and opt-outs; keep preload and renderer policies unchanged.

  Applications must ship their external production dependencies. Workspace packages exposing TypeScript source can be excluded from externalization so they remain bundled.

  Support automatic runtime dependency discovery from packaged manifests, including transitive and peer dependencies, optional packages, scoped and nested layouts, runtime assets, and unpacked native files checked against ASAR metadata. Reject unreachable package trees and missing required dependencies; retain explicit package lists for custom layouts. Keep the existing bundled-only policy by default and reject missing packages, unexpected files, links, source maps, and credential paths.

  Update the demo to package external `zod` alongside its compiled output. Move bundled workspace and renderer dependencies to development dependencies to avoid duplicate packaged copies, and align packaging filters and verification with the external-dependency default.

### Patch Changes

- Updated dependencies [e742b07]
  - @electron-spark/vite-plugin-external-deps@0.2.0
  - @electron-spark/vite-plugin-esm-shim@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [1e367b0]
  - @electron-spark/vite-plugin-electron-main@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [86f648b]
  - @electron-spark/vite-plugin-electron-main@0.1.1
