const { MODE, VITE_DEV_SERVER_URL } = process.env;

const IS_DEV = Boolean(VITE_DEV_SERVER_URL);
const IS_MAC_OS = process.platform === "darwin";

export { IS_DEV, IS_MAC_OS, MODE };
