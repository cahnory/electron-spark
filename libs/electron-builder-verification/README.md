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
  requiredEntries: ["dist/main/index.js", "dist/view/index.html"],
});
```

Point the four electron-builder hook settings at this module. Electron-builder selects the corresponding named export. The demo's `scripts/release-hooks.ts` is a working example.

`createPackageVerifier` accepts `requiredEntries`, `outputDir` (default `dist`) and `resourcesDir` (default `<outputDir>/main/resources`), all using archive-relative slash-separated paths. `package.json` is always required. Assets outside the output directory, hidden files, credential paths, source files, source maps, ASAR links and unpacked entries are rejected. Additional resource formats are allowed only inside `resourcesDir`. The hook removes Electron's stock `default_app.asar`, then validates the resource directory and archive.

`verifyEntries`, `verifyResources`, `requireNotarizationCredentials`, `verifyAppleSignature`, `verifyWindowsSignature`, and `appleRequirement` are also available individually.

Signed Windows releases require a Windows host. Apple verification requires `codesign`, `xcrun`, and `ditto`; Windows verification requires PowerShell. Optional `EXPECTED_APPLE_TEAM_ID` and `EXPECTED_WINDOWS_PUBLISHER` environment variables constrain publisher identity. macOS packaging requires a complete Apple ID or API credential set, or `APPLE_KEYCHAIN_PROFILE`, unless notarization is disabled in builder configuration.

Final artifact verification supports DMG, macOS application ZIP, and EXE files; update metadata (`.blockmap`, `.yml`, `.yaml`) is skipped. Other formats, including Linux packages, fail explicitly. For unsigned local builds, disable `afterSign` and `afterAllArtifactBuild`, set `forceCodeSigning: false`, and disable macOS notarization.
