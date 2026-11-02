import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mock, test } from "node:test";

const calls: [string, string[]][] = [];
let rejectSignature = false;
mock.module("node:child_process", {
  namedExports: {
    execFileSync(command: string, args: string[]) {
      calls.push([command, args]);
      if (command === "ditto") mkdirSync(`${args.at(-1)}/Example.app`);
      if (rejectSignature && command === "codesign") throw new Error("Invalid signature");
    },
  },
});
const { default: verifyArtifacts } = await import("../scripts/verify-artifacts.ts");

void test("final artifacts verify DMG and EXE signatures and the app inside ZIPs", async () => {
  await verifyArtifacts({
    artifactPaths: [
      "/tmp/Example.dmg",
      "/tmp/Example.exe",
      "/tmp/Example.zip",
      "/tmp/Example.zip.blockmap",
    ],
  });
  assert.ok(
    calls.some(([command, args]) => command === "codesign" && args.includes("/tmp/Example.dmg")),
  );
  assert.ok(calls.some(([command]) => command === "powershell.exe"));
  assert.ok(
    calls.some(([command, args]) => command === "xcrun" && args.at(-1)?.endsWith("/Example.app")),
  );
  assert.ok(!calls.some(([command, args]) => command === "xcrun" && args.at(-1)?.endsWith(".dmg")));
});

void test("invalid signatures and unsupported artifact formats fail the release", async () => {
  rejectSignature = true;
  await assert.rejects(
    verifyArtifacts({ artifactPaths: ["/tmp/Example.dmg"] }),
    /Invalid signature/,
  );
  rejectSignature = false;
  await assert.rejects(
    verifyArtifacts({ artifactPaths: ["/tmp/Example.AppImage"] }),
    /No release verification policy/,
  );
});
