import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { verifyAppleSignature, verifyWindowsSignature } from "./verify-signature.mjs";

async function verifyArtifact(artifact) {
  const extension = path.extname(artifact).toLowerCase();
  if (extension === ".exe") verifyWindowsSignature(artifact);
  else if (extension === ".dmg") verifyAppleSignature(artifact);
  else if (extension === ".zip") {
    const directory = await mkdtemp(path.join(tmpdir(), "verify-release-"));
    try {
      execFileSync("ditto", ["-x", "-k", artifact, directory], { stdio: "inherit" });
      const entries = await readdir(directory, { withFileTypes: true });
      if (entries.length !== 1 || !entries[0].isDirectory() || !entries[0].name.endsWith(".app")) {
        throw new Error(`Unexpected application archive contents: ${artifact}`);
      }
      verifyAppleSignature(path.join(directory, entries[0].name), { application: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } else if (![".blockmap", ".yml", ".yaml"].includes(extension)) {
    throw new Error(`No release verification policy for artifact: ${artifact}`);
  }
}

export default async function verifyArtifacts(result) {
  await Promise.all(result.artifactPaths.map(verifyArtifact));
  return [];
}
