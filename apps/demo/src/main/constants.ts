const { MODE } = process.env;

const IS_MAC_OS = process.platform === "darwin";

export { IS_MAC_OS, MODE };
