# @electron-spark/vite-plugin-electron-main

## 0.1.2

### Patch Changes

- 1e367b0: Clean up Electron's inherited process group on macOS and Linux, including workers
  that survive the main process, with graceful termination followed by forced
  termination. Use taskkill to terminate the descendant tree on Windows during
  development restarts and shutdowns. Run cleanup in an independent supervisor so
  it also runs when Vite crashes or is killed. Document platform and crash limitations.

## 0.1.1

### Patch Changes

- 86f648b: Resolve the macOS development executable to its real path so renamed app bundles retain their identity in the Dock and app switcher.
