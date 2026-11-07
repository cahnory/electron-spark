# @electron-spark/vite-plugin-electron-preload

## 0.2.0

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
