# External dependencies plugin

`@electron-spark/vite-plugin-external-deps` keeps packages declared in
`dependencies` and `optionalDependencies` outside server bundles. Scoped packages
and package subpaths are matched. Their transitive dependencies are resolved by
Node at runtime. Packages listed only in `devDependencies` remain subject to the
rest of your bundler configuration.

```ts
import { externalDeps } from "@electron-spark/vite-plugin-external-deps";

export default {
  plugins: [
    externalDeps({
      environment: "electron",
      projectDir: import.meta.dirname,
      include: ["additional-runtime-package"],
      exclude: ["workspace-source-package"],
    }),
  ],
};
```

`projectDir` defaults to Vite's root; set it when the source root differs from the
package root. Without `environment`, every server environment is selected. An
excluded package is left to the remaining resolver configuration; use Vite's
`resolve.noExternal` to bundle it if needed. Exclusions take precedence over
inclusions. Existing explicit bundler externals still apply.

The manifest is watched and reread on rebuild. A missing manifest is treated as
empty; invalid JSON fails the build. Manifest changes may require restarting Vite
if its own dependency resolution configuration also changed.

External packages must be installed as production dependencies and included by
your packager. Keep Electron itself in devDependencies and externalize it
separately. Native binaries must match Electron's ABI and the target platform.
Workspace packages exposing TypeScript source generally need exclusion so they
can be bundled. This plugin does not copy packages or rebuild native binaries.
