# @electron-spark/electron-builder-verification

## 0.3.1

### Patch Changes

- 0965374: Exclude `@types/*` peer dependencies from automatic runtime package requirements so type-only peers such as react-intl's `@types/react` do not fail packaging verification.

## 0.3.0

### Minor Changes

- e742b07: Add standalone server-environment plugins for production dependency externalization and Node ESM compatibility bindings. Enable both for Electron main builds, preserving package layouts for native libraries while bundling development dependencies. Support explicit dependency inclusions/exclusions and opt-outs; keep preload and renderer policies unchanged.

  Applications must ship their external production dependencies. Workspace packages exposing TypeScript source can be excluded from externalization so they remain bundled.

  Support automatic runtime dependency discovery from packaged manifests, including transitive and peer dependencies, optional packages, scoped and nested layouts, runtime assets, and unpacked native files checked against ASAR metadata. Reject unreachable package trees and missing required dependencies; retain explicit package lists for custom layouts. Keep the existing bundled-only policy by default and reject missing packages, unexpected files, links, source maps, and credential paths.

  Update the demo to package external `zod` alongside its compiled output. Move bundled workspace and renderer dependencies to development dependencies to avoid duplicate packaged copies, and align packaging filters and verification with the external-dependency default.

### Patch Changes

- 8040289: Publish a maintenance release through GitHub Actions to validate npm trusted publishing.

## 0.2.0

### Minor Changes

- 83bb205: Extract reusable release verification hooks and macOS development bundle preparation from the demo. Provide configurable archive entry policies and resolve Electron from the consuming application.
