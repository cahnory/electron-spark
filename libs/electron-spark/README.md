# electron-spark

Electron Spark provides packages for building Electron applications.

To create a new app, clone the [Electron Spark boilerplate](https://github.com/cahnory/electron-spark-boilerplate).
It includes Electron Spark, React, and TypeScript, with typed IPC, persistent
settings, and packaging configuration already wired up.

Use Node.js 24 or later and pnpm:

```sh
git clone https://github.com/cahnory/electron-spark-boilerplate.git my-app
cd my-app
pnpm install
pnpm dev
```

Follow the boilerplate's [customization guide](https://github.com/cahnory/electron-spark-boilerplate#make-it-yours)
to make it your own.

## Add packages to an existing app

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
