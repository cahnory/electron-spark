---
"@electron-spark/vite-plugin-electron-main": patch
---

Clean up Electron's inherited process group on macOS and Linux, including workers
that survive the main process, with graceful termination followed by forced
termination. Use taskkill to terminate the descendant tree on Windows during
development restarts and shutdowns. Run cleanup in an independent supervisor so
it also runs when Vite crashes or is killed. Document platform and crash limitations.
