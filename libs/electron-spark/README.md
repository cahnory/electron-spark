# electron-spark

Electron Spark provides packages for building Electron applications.

This package is a placeholder and package guide. It contains no runtime code,
exports, or dependencies. Install the scoped packages you need directly:

```sh
pnpm add @electron-spark/ipc @electron-spark/store
pnpm add -D @electron-spark/vite-config
```

| Package                       | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `@electron-spark/ipc`         | Typed IPC; use `/main` and `/renderer` in their respective Electron processes. |
| `@electron-spark/store`       | Storage adapters and persisted state.                                          |
| `@electron-spark/vite-config` | Vite configuration for Electron main, preload, and renderer builds.            |

Installing `electron-spark` alone does not install these packages.
The packages are consumed directly so applications can select their dependencies
and keep build tooling in `devDependencies`.
