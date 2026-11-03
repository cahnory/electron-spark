# Electron main plugin

`@electron-spark/vite-plugin-electron-main` builds and launches the configured
Electron main environment during Vite development. Successful rebuilds replace
the previous launch; failed builds keep it running. Vite server restarts and
server closure also clean up the previous launch.

## Process cleanup

Each launch has an independent Node supervisor connected to Vite through a
dedicated IPC channel. The supervisor owns Electron and performs cleanup when
Vite closes the channel, exits, crashes, or receives `kill -9`. It exits after
cleanup, and normal rebuilds wait for it before launching a replacement. The
supervisor runs separately from Vite's terminal process group.

On macOS and Linux, Electron runs in a separate process group. Cleanup sends
`SIGTERM` to that group, allows up to three seconds for graceful exit, then sends
`SIGKILL` to remaining group members. The deadline still applies when Electron
exits before its workers. If Electron quits or crashes, the supervisor also
cleans up the surviving group automatically.

On Windows, cleanup uses `taskkill /PID <pid> /T /F` to forcibly terminate Electron
and its descendant tree while Electron is still running. There is no graceful
signal phase on Windows.

Cleanup has these limits:

- On macOS and Linux, descendants that create a separate process group or session
  (for example, Node children spawned with `detached: true`) escape group cleanup.
  This also applies to Chromium helpers and `utilityProcess` descendants if they
  leave the inherited group.
- On Windows, descendants may survive if Electron exits before tree cleanup.
- Cleanup requires the supervisor to survive. Killing the supervisor with
  `SIGKILL`, or terminating it together with Vite, prevents cleanup. On macOS and
  Linux it handles `SIGTERM` and `SIGINT` by cleaning up before exiting.

Applications remain responsible for workers outside these bounds.

The supervisor uses Vite's Node executable and receives launch details through
IPC. It does not inject scripts through `NODE_OPTIONS` or write cleanup code to a
cache directory, so cleanup does not depend on Electron's Node-options fuse.
This behavior applies only to development launches, not packaged applications.
