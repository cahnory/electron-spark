---
"@electron-spark/vite-config": minor
"@electron-spark/vite-plugin-electron-preload": minor
"@electron-spark/vite-plugin-electron-renderer": minor
---

Discover preload modules from renderer imports using `preloadPatterns` (default:
`preload/**/*.ts`) and build one aggregate CommonJS preload per view. Module exports
are namespaced by source path, allowing multiple preloads with overlapping export
names and deduplicated shared dependencies. Development discovers the renderer
graph before launch and rebuilds aggregates when imports change.

Remove `webPreferences.preload` from window JSON when using `defineElectronConfig`.
Preload override callbacks now receive `view` instead of `entry`. The runtime
`exposeToRenderer` helper accepts the complete module registry. Custom configurations
can use `electronPreloadViews` with the renderer plugin's `preloadEnvironments` map.
