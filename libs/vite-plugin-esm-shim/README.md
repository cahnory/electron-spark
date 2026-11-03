# ESM shim plugin

`@electron-spark/vite-plugin-esm-shim` supplies module-local `require`, `__filename`,
and `__dirname` bindings in Node ESM output. CommonJS output is unchanged. Existing
module bindings are preserved, helper names avoid collisions, and sourcemaps and
hashbangs are retained. The shim runs per chunk, including dynamic imports.

```ts
import { esmShim } from "@electron-spark/vite-plugin-esm-shim";

export default {
  plugins: [esmShim({ environment: "electron" })],
};
```

Without `environment`, the plugin applies to every server environment. Use only
for Node environments, not browser or sandboxed preload code.

Paths refer to the emitted chunk, not the original source package. Keep packages
that locate native bindings or adjacent files external. This plugin does not
provide CommonJS `module` or `exports`, or rewrite relative `require()` paths.
