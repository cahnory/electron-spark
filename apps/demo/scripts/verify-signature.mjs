import { execFileSync } from "node:child_process";
import path from "node:path";

export function appleRequirement(team = process.env.EXPECTED_APPLE_TEAM_ID) {
  if (team && !/^[A-Z0-9]{10}$/.test(team)) throw new Error("Invalid EXPECTED_APPLE_TEAM_ID");
  return "anchor apple generic" + (team ? ` and certificate leaf[subject.OU] = "${team}"` : "");
}

export function verifyAppleSignature(file, { application = false, run = execFileSync } = {}) {
  run("codesign", ["--verify", ...(application ? ["--deep"] : []), "--strict", file], {
    stdio: "inherit",
  });
  run("codesign", ["--verify", "-R", appleRequirement(), file], { stdio: "inherit" });
  if (application) run("xcrun", ["stapler", "validate", file], { stdio: "inherit" });
}

export function verifyWindowsSignature(file, run = execFileSync) {
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$signature = Get-AuthenticodeSignature -LiteralPath $env:RELEASE_EXECUTABLE; if ($signature.Status -ne 'Valid') { throw 'Invalid release signature' }; if ($env:EXPECTED_WINDOWS_PUBLISHER -and $signature.SignerCertificate.Subject -cne $env:EXPECTED_WINDOWS_PUBLISHER) { throw 'Unexpected release publisher' }",
    ],
    {
      env: { ...process.env, RELEASE_EXECUTABLE: file },
      stdio: "inherit",
    },
  );
}

export default function verifySignature(context) {
  if (context.electronPlatformName === "darwin") {
    verifyAppleSignature(
      path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`),
      { application: true },
    );
  } else if (context.electronPlatformName === "win32") {
    verifyWindowsSignature(
      path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`),
    );
  }
}
