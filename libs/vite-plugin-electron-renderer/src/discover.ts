import fs from "node:fs";
import path from "node:path";

/** Resolve existing HTML entries from view directory patterns relative to Vite's root. */
export function discoverRendererHtml(
  root: string,
  viewPatterns: string | readonly string[],
  htmlEntry = "index.html",
): string[] {
  const patterns = ([] as readonly string[]).concat(viewPatterns);
  return [...new Set(fs.globSync(patterns.map((pattern) => path.resolve(root, pattern))))]
    .filter((directory) => fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory())
    .map((directory) => path.resolve(directory, htmlEntry))
    .filter((html) => fs.statSync(html, { throwIfNoEntry: false })?.isFile())
    .toSorted();
}
