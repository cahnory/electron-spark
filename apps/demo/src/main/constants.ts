import path from "node:path";

import { app } from "electron";

const MODE = app.isPackaged ? "production" : process.env.MODE;

const IS_MAC_OS = process.platform === "darwin";
const RESOURCES_PATH = path.join(import.meta.dirname, "resources");

export { IS_MAC_OS, MODE, RESOURCES_PATH };
