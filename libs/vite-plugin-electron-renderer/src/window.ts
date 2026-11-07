import fs from "node:fs";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read a renderer's presentation options. Execution settings belong to main. */
export function readRendererWindow(html: string, windowConfigPath = "window.json") {
  const file = path.resolve(path.dirname(html), windowConfigPath);
  if (!fs.existsSync(file)) return { file, window: {} as Record<string, unknown> };
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`Window options must be a JSON object: ${file}`);
  }
  if (Object.hasOwn(value, "webPreferences")) {
    throw new Error(
      `Remove webPreferences from ${file}; configure execution settings in the main process and import modules matching preloadPatterns from the view for generated preloads.`,
    );
  }
  const { $schema: _schema, ...window } = value;
  return { file, window };
}
