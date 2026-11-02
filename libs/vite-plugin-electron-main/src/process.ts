import { spawn } from "node:child_process";

import { superviseElectron } from "./supervisor.ts";

/** Launch through an independent owner that survives the Vite process. */
export function launchElectron(
  executable: string,
  entry: string,
  env: NodeJS.ProcessEnv,
  onError: (error: unknown) => void,
) {
  const supervisorEnv = { ...process.env };
  // The supervisor must not inherit injected preload scripts or inspector flags.
  delete supervisorEnv.NODE_OPTIONS;
  const supervisor = spawn(
    process.execPath,
    [
      "--input-type=commonjs",
      "-e",
      `(${superviseElectron.toString()})().catch(error => { console.error(error); process.exit(1); })`,
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: supervisorEnv,
    },
  );
  let reported: Error | undefined;
  const finished = new Promise<void>((resolve, reject) => {
    supervisor.once("error", reject);
    supervisor.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(reported ?? new Error(`Electron supervisor exited (${signal ?? code})`));
    });
  });
  void finished.catch((error: unknown) => {
    if (error !== reported) onError(error);
  });
  supervisor.on("message", (message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "error" &&
      "message" in message &&
      typeof message.message === "string"
    ) {
      reported = Object.assign(new Error(message.message), {
        code: "code" in message ? message.code : undefined,
      });
      onError(reported);
    }
  });
  supervisor.send({ executable, entry, env }, (error) => {
    if (error) {
      onError(error);
      if (supervisor.connected) supervisor.disconnect();
    }
  });
  let stopping: Promise<void> | undefined;
  return {
    stop() {
      stopping ??= Promise.resolve().then(() => {
        if (supervisor.connected) supervisor.disconnect();
        return finished;
      });
      return stopping;
    },
  };
}
