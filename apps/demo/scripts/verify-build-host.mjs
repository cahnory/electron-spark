export default function verifyBuildHost(context, hostPlatform = process.platform) {
  if (
    context.electronPlatformName === "win32" &&
    context.packager.config.forceCodeSigning !== false &&
    hostPlatform !== "win32"
  ) {
    throw new Error(
      "Windows releases must be built on Windows to verify Authenticode signatures. " +
        "Use a Windows build runner, or build:local for an unpacked local build.",
    );
  }
}
