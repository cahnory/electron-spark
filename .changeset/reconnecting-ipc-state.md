---
"@electron-spark/ipc": minor
---

Export subscribeIpcState from @electron-spark/ipc/renderer to manage state subscriptions with reconnect retries, exponential backoff, and cleanup without disposing the shared bridge.

Renderer runtime APIs are now exported exclusively from @electron-spark/ipc/renderer. Migrate root imports of createIpcApiBridge, createIpcApiClient, createIpcStateBridge, createIpcRendererBridge, and createIpcEventBridge to that entry. Shared types remain available from the root.
