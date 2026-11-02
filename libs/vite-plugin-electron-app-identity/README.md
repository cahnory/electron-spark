# @electron-spark/vite-plugin-electron-app-identity

Give a macOS Electron development app its own native name and bundle identifier without modifying the installed Electron distribution.

```ts
import { electronAppIdentity } from "@electron-spark/vite-plugin-electron-app-identity";

export default {
  plugins: [electronAppIdentity({ projectDir: import.meta.dirname })],
};
```

The plugin runs only during Vite development. `projectDir` defaults to the working directory, independently of Vite's renderer root. Electron is resolved from that project's dependencies. The app version comes from `package.json`; `productName` and `appId` default to `electron-builder.json` and can be supplied as options instead.

On macOS, the plugin copies Electron into `node_modules/.cache/dev-electron`, changes its native bundle metadata, signs the copy ad hoc, and sets `ELECTRON_OVERRIDE_DIST_PATH` for the launcher. The cache includes the Electron version and app identity. It requires the macOS `plutil` and `codesign` commands. Other platforms and explicit distribution overrides are left untouched. A process can use only one Electron distribution override.

`prepareElectronAppIdentity(options)` exposes the same preparation for non-Vite launchers. Run it before resolving or starting Electron.
