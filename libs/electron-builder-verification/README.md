# @electron-spark/electron-builder-verification

Electron-builder hooks for validating packaged files, build hosts, macOS signatures and notarization, Windows Authenticode signatures, and final release artifacts.

```ts
import { createPackageVerifier } from "@electron-spark/electron-builder-verification";
export {
  verifyBuildHost as beforePack,
  verifySignature as afterSign,
  verifyArtifacts as afterAllArtifactBuild,
} from "@electron-spark/electron-builder-verification";
export const afterPack = createPackageVerifier({
  dependencyPackages: "auto",
  requiredEntries: ["dist/main/index.js", "dist/view/index.html"],
});
```

Point the four electron-builder hook settings at this module. Electron-builder selects the corresponding named export. The demo's `scripts/release-hooks.ts` is a working example.

`createPackageVerifier` accepts `requiredEntries`, `outputDir` (default `dist`) and `resourcesDir` (default `<outputDir>/main/resources`), all using archive-relative slash-separated paths. `package.json` is always required. By default, assets outside the output directory, hidden files, credential paths, source files, source maps, ASAR links and unpacked entries are rejected. Additional resource formats are allowed only inside `resourcesDir`. The hook removes Electron's stock `default_app.asar`, then validates the resource directory and archive.

Set `dependencyPackages: "auto"` to derive the allowed package directories from the packaged application's `dependencies` and `optionalDependencies`, recursively following packaged dependency and peer manifests. This checks the archive itself, not the development checkout. Nested and hoisted layouts, scoped names, and dependency cycles are supported. Missing required dependencies and unreachable package trees fail verification; absent optional dependencies and optional peers are allowed. Type declaration peers in `@types/*` are excluded from runtime requirements; explicit dependencies on those packages are still checked. Keep packages bundled into your application in `devDependencies` to avoid requiring duplicate packaged copies.

An explicit array of package names remains available for custom packaging layouts. Without this option, the bundled-only policy is unchanged. Automatic discovery requires `createPackageVerifier` or `verifyPackage`; the filename-only `verifyEntries` helper cannot read manifests.

Allowed packages may contain runtime assets and licenses in addition to JavaScript, but hidden files, credential paths, TypeScript sources and maps remain forbidden. Configure the packager to exclude those development files. Unpacked files are permitted only within these packages, and the `app.asar.unpacked` tree must match the archive's unpacked entries without extra files or symlinks. Native binaries still need rebuilding for Electron's ABI and the target platform.

`verifyEntries`, `verifyResources`, `requireNotarizationCredentials`, `verifyAppleSignature`, `verifyWindowsSignature`, and `appleRequirement` are also available individually.

Signed Windows releases require a Windows host. Apple verification requires `codesign`, `xcrun`, and `ditto`; Windows verification requires PowerShell. Optional `EXPECTED_APPLE_TEAM_ID` and `EXPECTED_WINDOWS_PUBLISHER` environment variables constrain publisher identity. macOS packaging requires a complete Apple ID or API credential set, or `APPLE_KEYCHAIN_PROFILE`, unless notarization is disabled in builder configuration.

Final artifact verification supports DMG, macOS application ZIP, and EXE files; update metadata (`.blockmap`, `.yml`, `.yaml`) is skipped. Other formats, including Linux packages, fail explicitly. For unsigned local builds, disable `afterSign` and `afterAllArtifactBuild`, set `forceCodeSigning: false`, and disable macOS notarization.
