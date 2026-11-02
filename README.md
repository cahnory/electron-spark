# Electron Spark

<p align="center">
  <img src="docs/assets/electron-spark.png" alt="Electron Spark illustration" width="320" />
</p>

**A little setup. A lot of possibility.**

Electron Spark is a TypeScript foundation for building desktop applications with
Electron and Vite. It brings together development tooling, typed communication
between processes, persistent state, and packaging safeguards so you can focus
on what your application does.

Use the individual `@electron-spark/*` packages in your Electron project, with
`apps/demo` as an example of how to put them together. This workspace is the
Electron Spark development project. Your application owns its interface,
features, and integrations.

## What you can build on

- ⚡ **A coordinated development workflow.** Build main, preload, and renderer code
  with Vite, with watched builds and Electron restarts during development.
- 🔗 **Typed process communication.** Define validated commands, synchronize state,
  and send events through explicit access policies with `@electron-spark/ipc`.
- 💾 **Persistent application data.** Use interchangeable memory and filesystem
  storage, schema validation, and versioned migrations with `@electron-spark/store`.
- 🧩 **Flexible windows and views.** Discover renderer entries and their preload
  scripts, configure windows, and adapt the structure as your application grows.
- 📦 **A path to distribution.** Build locally or prepare signed releases with
  checks for packaged files, signatures, and Electron security settings.

The example application shows how React, TypeScript styles, routing, and
internationalization can fit together. These are starting points you can extend
or replace to suit your product.

## Get started

In your Electron project, install only the packages you need:

```sh
pnpm add @electron-spark/ipc @electron-spark/store
pnpm add -D @electron-spark/vite-config
```

Refer to `apps/demo` for an integration example: application lifecycle and native
integration live in `src/main`, while the interface lives in `src/view`.

To explore the demo from a checkout of this repository, use Node.js 24 or later
and the pnpm version pinned in `packageManager`:

```sh
pnpm install
pnpm --filter @electron-spark/demo dev
```

| Package                                                         | Purpose                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [IPC](libs/ipc/README.md)                                       | Validated commands, synchronized state, events, and process access policies. |
| [Store](libs/store/README.md)                                   | Storage adapters, schema validation, and versioned persistence.              |
| [Vite config](libs/vite-config/README.md)                       | Shared configuration for main, preload, and renderer builds.                 |
| [Renderer plugin](libs/vite-plugin-electron-renderer/README.md) | Renderer discovery, window configuration, and generated manifests.           |
| `@electron-spark/vite-plugin-electron-main`                     | Build and launch the Electron main process.                                  |
| `@electron-spark/vite-plugin-electron-preload`                  | Build preload scripts and expose APIs to renderers.                          |
| `@electron-spark/vite-plugin-build-on-serve`                    | Run watched builds alongside the development server.                         |

The repository uses a private `electron-spark-workspace` root. The publishable
[`electron-spark`](libs/electron-spark/README.md) package is a package guide with
no re-exports or dependencies. Install the scoped packages directly; keep
`vite-config` in development dependencies.

## Development checks

Run `pnpm check` from the root after installing dependencies. Tests use Node.js
native TypeScript support and experimental module mocks.

| Command             | From the root                                      | From a package                                                |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `pnpm check`        | All checks in parallel, output grouped by check    | Package types, tests, lint, and formatting in parallel        |
| `pnpm check:types`  | Repository tooling and every package's sources     | Package sources; IPC type tests; demo main, preload, and view |
| `pnpm check:test`   | Tests across the workspace                         | Package tests                                                 |
| `pnpm check:unused` | Workspace-wide Knip analysis                       | Available only at the root                                    |
| `pnpm check:lint`   | Repository-wide Oxlint, warnings treated as errors | Package lint                                                  |
| `pnpm check:format` | Repository-wide Oxfmt                              | Package formatting                                            |

To target a package from the root:

```sh
pnpm --filter @electron-spark/ipc check
pnpm --filter @electron-spark/demo check:test
```

The root `tsconfig.json` covers repository tooling, including package Vite and
tsdown configurations. Project configurations cover their sources; IPC also has
a configuration for its type tests.

Tools are installed at the root and available to package scripts. Global lint
and formatting commands already scan the whole repository, so they do not
repeat the same analysis in each package. Knip runs once to track imports and
exports across packages. Its configuration recognizes Electron, preload, and
TanStack route entry points; generated exports are excluded from unused-export
reports.

The example application's `apps/demo/.oxlintrc.json` extends the root rules and
loads `eslint-plugin-formatjs`, installed only in its `devDependencies`. Root
`check:lint` and `fix:lint` commands discover this configuration automatically;
do not pass `--config`, which would disable nested configurations. FormatJS
rules check messages declared in code for placeholders, plurals, whitespace,
and offsets. `formatjs/enforce-id` requires a literal `defaultMessage` and
produces IDs using `[sha512:contenthash:base64:6]`. The Oxc extension applies this
fix on save, or through `pnpm fix:lint`. English and French catalogs use the same
IDs; update them after changing source text. Tests check English catalog hashes,
translation coverage, and formatting. The plugin does not check catalogs directly.

Type checks and tests use pnpm's task orchestration: by default, each task waits
for the same task in its workspace dependencies. Ready tasks run in parallel
with output grouped by package. `--no-bail` lets independent branches finish
after a failure; the command exits with a nonzero code if any check fails. No
prior build is needed because workspace exports point to TypeScript sources.
If a future task requires a build, declare its dependency in `tasks` in
`pnpm-workspace.yaml`.

Existing `test` and `typecheck` commands remain available as aliases where defined.
Tests display a per-package summary on success and a detailed report on failure.
For detailed output on demand, run Node with `--test-reporter=spec` instead of the
shared reporter.

## Builds and secure distribution

From `apps/demo`, `pnpm build:dist` only compiles the application. `pnpm build`
runs checks, compiles, and produces a signed distribution. Packaging fails
without signing credentials; macOS also requires notarization credentials and
verifies the stapled ticket after signing. Configure electron-builder signing
certificates through the keychain or `CSC_LINK` and `CSC_KEY_PASSWORD` (and their
Windows equivalents where needed). Never put these files or values in `src`,
`public`, `resources`, or artifacts.

For an application used only locally, `pnpm build:local` creates an unpacked app
in `release/local/<version>` without requiring a distribution certificate or
notarization. On macOS, local ad hoc signing enables execution, including on
Apple Silicon. On Windows, signing is optional and can use credentials already
configured. File checks, fuses, and production protections remain active.
`pnpm build` retains mandatory signing and separate distribution outputs.

For macOS notarization, provide one of these credential sets:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`;
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`;
- `APPLE_KEYCHAIN_PROFILE` and optionally `APPLE_KEYCHAIN`.

Main and preload dependencies are bundled. Packaging excludes `node_modules`,
TypeScript sources, and source maps. A hook also inspects the actual contents of
`app.asar` and rejects files outside `dist`, unexpected extensions, hidden files,
identifiable secret files, and unpacked files. Adding native modules or new
resource types requires an explicit adjustment to this policy and verification
of the final artifact.

Files in `src/resources` are copied to `dist/main/resources` in development and
production, then included in ASAR. Main can read them through `RESOURCES_PATH`
(in `src/main/constants.ts`). Resources may use any extension except TypeScript
sources, source maps, and certificates/private keys excluded by the packaging
policy. They are read-only; keep mutable data in an appropriate directory.
The development HTTP server blocks this directory.

Publishing is disabled (`publish: null` and `--publish never`). Before adding
an updater or publishing, explicitly define the application identity, repository,
and update provider; also adapt the hook that rejects `app-update.yml`. Do not
publish the entire `release` directory: it may contain old artifacts and
diagnostic files. Distribute only the verified installers from the relevant build.

Fuses disable RunAsNode, Node environment options, and the Node inspector; they
enable cookie encryption and loading exclusively from an integrity-validated
ASAR. Use `utilityProcess` instead of `child_process.fork` for additional Node
processes.

Production builds reject window options that disable isolation, sandboxing, or
web security, enable Node in renderers, or enable experimental features. The
production CSP does not allow inline scripts or styles; exceptions needed by
Vite/React are added only by the development server. Explicitly add allowed
origins to `connect-src` if the application uses a remote service.

All distributed code, including main and preload scripts, is readable by users.
ASAR and `.gitignore` do not protect secrets: never embed server secrets in code,
assets, or `VITE_*` values. Filename checks do not replace content review. Keep
server secrets on the server and release credentials in the CI secret manager;
install with `pnpm install --frozen-lockfile` in a clean checkout and keep
Electron and dependencies up to date.

Packaged applications ignore `MODE=test`. Electron sessions deny permissions by
default; declare exceptions in `configureSessionPermissions` with an exact
HTTP(S) origin and the required permissions, for the main frame only. This
policy is installed before window creation for both the default and new sessions.

Each compiled renderer receives a restrictive CSP if one is missing. An existing
CSP must restrict scripts to `self`, hashes, or nonces, forbid objects, and
restrict `base-uri`. It is reapplied at the start of the head. Additional resources
are rejected except explicitly allowed Electron files; macOS translation
directories must be empty.

To enforce signer identity, set `EXPECTED_APPLE_TEAM_ID` (10 characters) and/or
`EXPECTED_WINDOWS_PUBLISHER` (the exact Authenticode certificate subject). After
artifact creation, DMG signatures are verified; for macOS ZIP files, the extracted
application's signature and notarization ticket are verified. Windows installers
must have a valid Authenticode signature. Local builds retain their exemption
from distribution signature checks.

Windows releases must be built on Windows, where PowerShell verifies Authenticode.
A `beforePack` check rejects Windows releases from macOS or Linux before packaging;
local unpacked builds remain possible with `build:local`.
