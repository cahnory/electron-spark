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
