import fs from "node:fs";
import path from "node:path";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readWindowOptions(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Window options must be a JSON object: ${file}`);
  }
  const { $schema: _schema, ...options } = value;
  if (options.webPreferences !== undefined && !isRecord(options.webPreferences)) {
    throw new Error(`webPreferences must be a JSON object: ${file}`);
  }
  return options;
}

/** Read a renderer's window options and resolve its declared preload source. */
export function readRendererWindow(
  html: string,
  windowConfigPath = "window.json",
  { validatePreload = true }: { validatePreload?: boolean } = {},
) {
  const file = path.resolve(path.dirname(html), windowConfigPath);
  const window = readWindowOptions(file);
  const source = isRecord(window.webPreferences) ? window.webPreferences.preload : undefined;
  let preload: string | undefined;
  if (source !== undefined) {
    if (typeof source !== "string" || !source.trim()) {
      throw new Error(`webPreferences.preload must be a non-empty string: ${file}`);
    }
    preload = path.resolve(path.dirname(file), source);
    if (validatePreload && !fs.statSync(preload, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Preload source does not exist or is not a file: ${preload} (from ${file})`);
    }
  }
  return { file, window, preload };
}
