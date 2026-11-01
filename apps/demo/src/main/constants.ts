import { app } from "electron";

const MODE = app.isPackaged ? "production" : process.env.MODE;

const IS_MAC_OS = process.platform === "darwin";

export { IS_MAC_OS, MODE };
