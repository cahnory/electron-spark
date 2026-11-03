# @electron-spark/vite-plugin-external-deps

## 0.2.0

### Minor Changes

- e742b07: Add standalone server-environment plugins for production dependency externalization and Node ESM compatibility bindings. Enable both for Electron main builds, preserving package layouts for native libraries while bundling development dependencies. Support explicit dependency inclusions/exclusions and opt-outs; keep preload and renderer policies unchanged.

  Applications must ship their external production dependencies. Workspace packages exposing TypeScript source can be excluded from externalization so they remain bundled.

  Support automatic runtime dependency discovery from packaged manifests, including transitive and peer dependencies, optional packages, scoped and nested layouts, runtime assets, and unpacked native files checked against ASAR metadata. Reject unreachable package trees and missing required dependencies; retain explicit package lists for custom layouts. Keep the existing bundled-only policy by default and reject missing packages, unexpected files, links, source maps, and credential paths.

  Update the demo to package external `zod` alongside its compiled output. Move bundled workspace and renderer dependencies to development dependencies to avoid duplicate packaged copies, and align packaging filters and verification with the external-dependency default.
