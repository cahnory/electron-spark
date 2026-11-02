Place application resources in this directory, using any subdirectory structure.
Files are copied unchanged to `dist/main/resources` during development and builds
and included in the packaged app. Read them from the main process using
`RESOURCES_PATH` from `src/main/constants.ts`.

Packaged resources are read-only. Store writable application data separately.
The development HTTP server does not serve this directory.
