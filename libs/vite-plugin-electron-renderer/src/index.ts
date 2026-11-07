import fs from "node:fs";
import path from "node:path";

import { waitForBuildOnServe } from "@electron-spark/vite-plugin-build-on-serve";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { normalizePath, type Plugin, type ResolvedConfig, type ViteDevServer } from "vite";

import { productionCsp } from "./csp.ts";
import { discoverRendererHtml } from "./discover.ts";
import { isRecord, readRendererWindow, validateProductionWindow } from "./window.ts";

export type ElectronRendererOptions = {
  /** View directory patterns relative to Vite's root; re-evaluate config when matches change. */
  viewPatterns?: string | readonly string[] | undefined;
  /** HTML entry relative to each matched directory (defaults to index.html). */
  htmlEntry?: string | undefined;
  /** Generated module path, relative to the Electron entry file's directory. */
  rendererManifestPath?: string | undefined;
  /** Window configuration JSON path, relative to each renderer HTML directory. */
  windowConfigPath?: string | undefined;
  /** Map HTML entries (relative to root) to generated aggregate preload environments. */
  preloadEnvironments?: Record<string, string> | undefined;
  electronEnvironment: string;
  /** Optional override; otherwise discover the client environment containing HTML inputs. */
  clientEnvironment?: string | undefined;
};

export { readRendererWindow } from "./window.ts";
export { discoverRendererHtml } from "./discover.ts";

type HtmlNode = DefaultTreeAdapterMap["node"];

function htmlMetadata(source: string) {
  let title: string | undefined;
  let icon: string | undefined;
  const text = (node: HtmlNode): string =>
    "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(text).join("") : "";
  const visit = (node: HtmlNode) => {
    if ("tagName" in node) {
      if (node.tagName === "title" && title === undefined) title = text(node).trim();
      if (node.tagName === "link" && icon === undefined) {
        const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
        if (attrs.rel?.toLowerCase().split(/\s+/).includes("icon") && attrs.href) icon = attrs.href;
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(source));
  return { title, icon };
}

/** Collect emitted renderer/preload paths and generate an importable Electron module. */
export const electronRenderer = (options: ElectronRendererOptions): Plugin => {
  const electron = options.electronEnvironment;

  if (!electron) {
    throw new Error("electronRenderer requires electronEnvironment.");
  }

  let client: string;
  let renderers: { key: string; html: string; preload?: string; source?: string }[] = [];
  let preloads: string[] = [];
  let config: ResolvedConfig;
  let active = false;
  let restarting = false;
  let server: ViteDevServer | undefined;
  const outputs = new Map<string, string>();
  const htmlOutputs = new Set<string>();
  const icons = new Map<string, string>();
  const iconReferences = new Map<string, string>();
  let ready = Promise.withResolvers<void>();
  const runtimePaths = new Map<string, string>();
  let electronEntry: string;
  const generatedFile = () =>
    path.resolve(
      path.dirname(electronEntry),
      options.rendererManifestPath ?? "renderers.generated.ts",
    );

  const relative = (file: string) =>
    normalizePath(path.relative(path.dirname(generatedFile()), file));

  let runtimeContent: string | undefined;

  const windowFile = (html: string) =>
    path.resolve(path.dirname(html), options.windowConfigPath ?? "window.json");
  const metadata = (
    html: string,
  ): { window: Record<string, unknown>; icon: string | undefined } => {
    const defaults = htmlMetadata(fs.readFileSync(html, "utf8"));
    const { window } = readRendererWindow(html, options.windowConfigPath, {
      allowPreload: !options.preloadEnvironments,
    });
    if (!server) validateProductionWindow(window, windowFile(html));
    let icon: string | undefined;
    if (typeof window.icon === "string") {
      icon = path.resolve(path.dirname(html), window.icon);
    } else if (defaults.icon) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(defaults.icon)) {
        throw new Error(`Renderer favicon must be a local file for BrowserWindow: ${html}`);
      }
      const href = decodeURIComponent(defaults.icon.split(/[?#]/)[0]);
      const publicIcon =
        config.publicDir && path.resolve(config.publicDir, href.replace(/^\//, ""));
      icon = href.startsWith("/")
        ? publicIcon && fs.existsSync(publicIcon)
          ? publicIcon
          : path.resolve(config.root, href.slice(1))
        : path.resolve(path.dirname(html), href);
    } else if (config.publicDir && fs.existsSync(path.join(config.publicDir, "favicon.ico"))) {
      icon = path.join(config.publicDir, "favicon.ico");
    }
    return {
      window: { ...(defaults.title !== undefined ? { title: defaults.title } : {}), ...window },
      icon,
    };
  };

  const generate = () => {
    if (restarting || preloads.some((name) => !outputs.has(name))) {
      return;
    }

    const url = server && (server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]);
    if (server && !url) {
      throw new Error("electronRenderer requires a listening Vite server with a resolved URL.");
    }

    const clientOut = path.resolve(config.root, config.environments[client].build.outDir);
    runtimePaths.clear();
    const runtimePath = (file: string, target = file) => {
      const relativePath = relative(file);
      runtimePaths.set(relativePath, target);
      return `__electron_renderer_resolve:${relativePath}`;
    };
    const data = {
      mode: "__electron_renderer_mode",
      renderers: Object.fromEntries(
        renderers.map((renderer) => {
          const html = normalizePath(
            path.relative(config.root, path.resolve(config.root, renderer.html)),
          );
          if (html.startsWith("../")) {
            throw new Error(`Renderer HTML must be inside Vite's root: ${renderer.html}`);
          }

          if (!server && !htmlOutputs.has(html)) {
            throw new Error(`Renderer HTML was not emitted: ${html}`);
          }

          const { window, icon } = metadata(renderer.html);
          return [
            renderer.key,
            {
              location: html.split("/").map(encodeURIComponent).join("/"),
              path: runtimePath(path.resolve(clientOut, html)),
              window: {
                ...window,
                ...(icon
                  ? {
                      icon: runtimePath(
                        icon,
                        server ? icon : path.resolve(clientOut, icons.get(icon)!),
                      ),
                    }
                  : {}),
                ...(renderer.preload
                  ? {
                      webPreferences: {
                        ...(isRecord(window.webPreferences) ? window.webPreferences : {}),
                        preload: runtimePath(
                          renderer.source!,
                          path.resolve(
                            path.dirname(generatedFile()),
                            outputs.get(renderer.preload)!,
                          ),
                        ),
                      },
                    }
                  : {}),
              },
            },
          ];
        }),
      ),
    };
    const nextRuntimeContent = JSON.stringify({ url, paths: [...runtimePaths] });
    const runtimeChanged = runtimeContent !== nextRuntimeContent;
    runtimeContent = nextRuntimeContent;
    const file = generatedFile();

    const serialized = JSON.stringify(data, null, 2)
      .replace(
        /"location": ("(?:[^"\\]|\\.)*"),\n\s*"path": "__electron_renderer_resolve:((?:[^"\\]|\\.)*)"/g,
        (_properties, location: string, relativePath: string) =>
          `...(VITE_DEV_SERVER_URL ? { url: new URL(${location}, VITE_DEV_SERVER_URL).href } : { path: resolve(dirname, ${JSON.stringify(JSON.parse(`"${relativePath}"`))}) })`,
      )
      .replace(
        /"__electron_renderer_resolve:((?:[^"\\]|\\.)*)"/g,
        (_property, value: string) =>
          `resolve(dirname, ${JSON.stringify(JSON.parse(`"${value}"`))})`,
      );
    const content = `// Generated by electronRenderer. Do not edit.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

declare const VITE_DEV_SERVER_URL: string | undefined;

const dirname = typeof __dirname === "string" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
const rendererData = ${serialized.replace('"__electron_renderer_mode"', '(VITE_DEV_SERVER_URL ? "serve" : "build")')};


type Renderers = typeof rendererData.renderers;
type RendererData<Mode extends "serve" | "build"> = {
  mode: Mode;
  renderers: {
    [Key in keyof Renderers]: Omit<Renderers[Key], "url" | "path"> &
      Record<Mode extends "serve" ? "url" : "path", string>;
  };
};

export default rendererData as RendererData<"serve"> | RendererData<"build">;
`;
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    } else if (runtimeChanged && server) {
      // Invalidate the watched main build when emitted paths change without
      // changing the tracked source (for example a hashed preload filename).
      const now = new Date();
      fs.utimesSync(file, now, now);
    }

    ready.resolve();
  };

  const collector = {
    name: "electron-renderer-collector",
    // Injected into inline config for watched builds; never run an old collector
    // in the replacement dev server while Vite is restarting.
    apply: "build",
    config() {
      const url = server && (server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]);
      return {
        environments: {
          [electron]: { define: { VITE_DEV_SERVER_URL: url ? JSON.stringify(url) : "undefined" } },
        },
      };
    },
    buildStart() {
      if (this.environment.name !== client) return;
      iconReferences.clear();
      for (const renderer of renderers) {
        this.addWatchFile(windowFile(renderer.html));
        const { icon } = metadata(renderer.html);
        if (icon && !iconReferences.has(icon)) {
          this.addWatchFile(icon);
          iconReferences.set(
            icon,
            this.emitFile({
              type: "asset",
              name: path.basename(icon),
              source: fs.readFileSync(icon),
            }),
          );
        }
      }
    },
    transform(code, id) {
      if (
        this.environment.name !== electron ||
        normalizePath(id.split("?")[0]) !== normalizePath(generatedFile())
      ) {
        return null;
      }

      // Preserve source-relative paths on disk, then rebase for the chunk containing this module.
      let transformed = code;

      for (const [relativePath] of runtimePaths) {
        transformed = transformed.replaceAll(
          `resolve(dirname, ${JSON.stringify(relativePath)})`,
          `resolve(dirname, ${JSON.stringify(`__electron_renderer_path:${relativePath}`)})`,
        );
      }

      return { code: transformed, map: null };
    },
    renderChunk(code, chunk, output) {
      if (this.environment.name !== electron) {
        return null;
      }

      const directory = path.dirname(
        path.resolve(output.dir ?? path.dirname(output.file!), chunk.fileName),
      );
      let transformed = code;

      for (const [relativePath, absolutePath] of runtimePaths) {
        const marker = `__electron_renderer_path:${relativePath}`;
        transformed = transformed.replaceAll(
          JSON.stringify(marker),
          JSON.stringify(normalizePath(path.relative(directory, absolutePath)) || "."),
        );
      }

      return { code: transformed, map: null };
    },
    writeBundle(output, bundle) {
      const name = this.environment.name;
      if (preloads.includes(name)) {
        const entries = Object.values(bundle).filter(
          (item) => item.type === "chunk" && item.isEntry,
        );
        if (entries.length !== 1) {
          throw new Error(`Renderer preload environment '${name}' must emit exactly one entry.`);
        }

        outputs.set(
          name,
          relative(path.resolve(output.dir ?? path.dirname(output.file!), entries[0].fileName)),
        );
        if (server) {
          generate();
        }
      }

      if (name === client) {
        for (const [icon, reference] of iconReferences)
          icons.set(icon, this.getFileName(reference));
        for (const item of Object.values(bundle)) {
          if (item.type === "asset" && item.fileName.endsWith(".html")) {
            htmlOutputs.add(item.fileName);
          }
        }
      }
    },
  } satisfies Plugin;

  const listening = () => {
    if (!preloads.length) {
      generate();
    }
  };

  return {
    name: "@electron-spark/vite-plugin-electron-renderer",
    sharedDuringBuild: true,
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return server ? undefined : productionCsp(html);
      },
    },
    config() {
      return { environments: { [electron]: { define: { VITE_DEV_SERVER_URL: "undefined" } } } };
    },
    configResolved: (resolved) => {
      // buildOnServe re-resolves config; its collector is injected below and owns dev state.
      active = !Object.values(resolved.environments).some((env) => env.build.watch);
      if (!active) {
        return;
      }

      config = resolved;

      if (!config.environments[electron]) {
        throw new Error(`Unknown Electron environment: ${electron}`);
      }

      const inputs = (name: string) => {
        const environment = config.environments[name];
        const input =
          environment.build.rolldownOptions.input ??
          environment.input ??
          (typeof environment.build.ssr === "string" ? environment.build.ssr : undefined);
        const entries =
          typeof input === "string"
            ? [input]
            : Array.isArray(input)
              ? input
              : Object.values(input ?? {});

        return entries.map((entry) => path.resolve(config.root, entry));
      };
      const electronInputs = inputs(electron);
      if (electronInputs.length !== 1) {
        throw new Error(
          `Electron environment '${electron}' must have exactly one input to locate the generated renderer module.`,
        );
      }

      electronEntry = electronInputs[0];

      if (generatedFile() === electronEntry) {
        throw new Error("The generated renderer filename must not overwrite the Electron entry.");
      }

      const candidates = Object.entries(config.environments).filter(([name, environment]) => {
        if (options.clientEnvironment) {
          return name === options.clientEnvironment;
        }

        return (
          environment.consumer === "client" &&
          ((name === "client" && options.viewPatterns !== undefined) ||
            inputs(name).some((entry) => entry.endsWith(".html")) ||
            (name === "client" &&
              !inputs(name).length &&
              fs.existsSync(path.resolve(config.root, "index.html"))))
        );
      });
      if (candidates.length !== 1) {
        throw new Error(
          "electronRenderer requires one client environment with HTML inputs; use clientEnvironment to select one.",
        );
      }

      client = candidates[0][0];

      if (candidates[0][1].consumer !== "client") {
        throw new Error(`Renderer environment '${client}' must have consumer: 'client'.`);
      }

      const htmlInputs = inputs(client);
      if (!htmlInputs.length && options.viewPatterns === undefined) {
        htmlInputs.push(path.resolve(config.root, "index.html"));
      }

      const serverInputs = Object.entries(config.environments)
        .filter(([name, environment]) => name !== electron && environment.consumer === "server")
        .flatMap(([name]) => inputs(name).map((entry) => ({ name, entry })));
      const keys = new Set<string>();

      renderers = htmlInputs
        .filter((entry) => entry.endsWith(".html"))
        .map((html) => {
          const directory = path.dirname(html);
          const key = normalizePath(path.relative(config.root, directory)) || ".";
          if (key === ".." || key.startsWith("../")) {
            throw new Error(`Renderer HTML must be inside Vite's root: ${html}`);
          }

          if (keys.has(key)) {
            throw new Error(`Multiple renderer HTML entries use the same directory: ${key}`);
          }

          keys.add(key);

          if (options.preloadEnvironments) {
            const preload =
              options.preloadEnvironments[normalizePath(path.relative(config.root, html))];
            if (!preload || !config.environments[preload] || inputs(preload).length !== 1) {
              throw new Error(
                `Renderer '${key}' requires a preload environment with exactly one generated input.`,
              );
            }
            return { key, html, preload, source: inputs(preload)[0] };
          }
          const { preload: source } = readRendererWindow(html, options.windowConfigPath);
          const matches = source ? serverInputs.filter(({ entry }) => entry === source) : [];
          if (source && !matches.length) {
            throw new Error(
              `No preload environment for '${source}' declared by ${windowFile(html)}.`,
            );
          }
          if (matches.length > 1) {
            throw new Error(`Ambiguous preload entries for renderer '${key}'.`);
          }

          const preload = matches[0]?.name;
          if (preload && inputs(preload).length !== 1) {
            throw new Error(
              `Renderer preload environment '${preload}' must have exactly one input.`,
            );
          }

          return preload && source ? { key, html, preload, source } : { key, html };
        });

      preloads = [...new Set(renderers.flatMap(({ preload }) => (preload ? [preload] : [])))];
    },
    configureServer: (candidate) => {
      server = candidate;
      restarting = false;
      outputs.clear();
      ready = Promise.withResolvers<void>();
      waitForBuildOnServe(candidate, electron, ready.promise);

      // buildOnServe forwards inline plugins to every isolated watched build.
      const previous = candidate.config.inlineConfig.plugins ?? [];
      candidate.config.inlineConfig.plugins = [...previous, collector];

      let timer: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      let sourceChanged = false;
      const watchedSources = new Set(
        options.preloadEnvironments
          ? []
          : renderers.flatMap(({ source }) => (source ? [source] : [])),
      );
      const watchedWindows = new Set(renderers.map(({ html }) => windowFile(html)));
      const refresh = () => {
        if (closed || restarting) return;
        let missingSources: string[] = [];
        try {
          const htmlFiles =
            options.viewPatterns === undefined
              ? renderers.map(({ html }) => html).filter((html) => fs.existsSync(html))
              : discoverRendererHtml(config.root, options.viewPatterns, options.htmlEntry);
          for (const html of htmlFiles) {
            watchedWindows.add(windowFile(html));
            candidate.watcher.add([windowFile(html), path.dirname(windowFile(html))]);
          }
          if (options.preloadEnvironments) {
            if (
              htmlFiles.length !== renderers.length ||
              htmlFiles.some((html) => !renderers.some((renderer) => renderer.html === html))
            ) {
              restarting = true;
              void candidate
                .restart()
                .catch((error: unknown) => candidate.config.logger.error(String(error)))
                .finally(() => {
                  if (!closed) restarting = false;
                });
            } else if (candidate.resolvedUrls) {
              generate();
            }
            return;
          }
          // Watch declared sources even when they do not exist yet. A subsequent creation
          // must recover without requiring another edit to window.json.
          const declarations = htmlFiles.map((html) => ({
            html,
            source: readRendererWindow(html, options.windowConfigPath, { validatePreload: false })
              .preload,
          }));
          for (const { source } of declarations) {
            if (source) {
              watchedSources.add(source);
              candidate.watcher.add([source, path.dirname(source)]);
            }
          }
          missingSources = declarations.flatMap(({ source }) =>
            source && !fs.statSync(source, { throwIfNoEntry: false })?.isFile() ? [source] : [],
          );
          for (const { html } of declarations) readRendererWindow(html, options.windowConfigPath);
          const changed =
            sourceChanged ||
            declarations.length !== renderers.length ||
            declarations.some(
              ({ html, source }) =>
                !renderers.some((renderer) => renderer.html === html && renderer.source === source),
            );
          if (changed) {
            restarting = true;
            void candidate
              .restart()
              .catch((error: unknown) => candidate.config.logger.error(String(error)))
              .finally(() => {
                // Vite can report a config failure without rejecting restart().
                // Keep the old watcher usable so a corrected file can retry.
                if (!closed) restarting = false;
              });
          } else if (candidate.resolvedUrls) {
            generate();
          }
        } catch (error) {
          candidate.config.logger.error(String(error));
          if (missingSources.length) {
            // A source can appear while the asynchronous watcher.add() is still
            // initializing, so recovery cannot depend on receiving its add event.
            const retry = () => {
              if (closed || restarting) return;
              if (
                missingSources.every((source) =>
                  fs.statSync(source, { throwIfNoEntry: false })?.isFile(),
                )
              ) {
                refresh();
              } else {
                timer = setTimeout(retry, 75);
              }
            };
            clearTimeout(timer);
            timer = setTimeout(retry, 75);
          }
        }
      };
      const schedule = (event: string, file: string) => {
        file = path.resolve(file);
        const known = watchedWindows.has(file) || renderers.some(({ html }) => file === html);
        const source = watchedSources.has(file) && (event === "add" || event === "unlink");
        const structure =
          options.viewPatterns !== undefined &&
          (event === "add" || event === "unlink") &&
          path.basename(file) === path.basename(options.htmlEntry ?? "index.html");
        if (closed || restarting || (!known && !source && !structure)) return;
        sourceChanged ||= source;
        clearTimeout(timer);
        timer = setTimeout(refresh, 75);
      };
      candidate.watcher.add([
        ...(options.viewPatterns === undefined ? [] : [config.root]),
        ...renderers.flatMap(({ html, source }) => [
          html,
          windowFile(html),
          path.dirname(windowFile(html)),
          ...(source ? [source, path.dirname(source)] : []),
        ]),
      ]);
      const added = (file: string) => schedule("add", file);
      const changed = (file: string) => schedule("change", file);
      const removed = (file: string) => schedule("unlink", file);
      candidate.watcher.on("add", added).on("change", changed).on("unlink", removed);
      candidate.httpServer?.once("listening", listening);
      candidate.httpServer?.once("close", () => {
        closed = true;
        clearTimeout(timer);
        candidate.watcher.off("add", added).off("change", changed).off("unlink", removed);
        candidate.httpServer?.off("listening", listening);
        // Vite initializes the replacement server before closing this one.
        // Remove only this collector, preserving the new server's plugins.
        candidate.config.inlineConfig.plugins = (
          candidate.config.inlineConfig.plugins ?? []
        ).filter((plugin) => plugin !== collector);
        ready.resolve();
      });
    },
    buildApp: async (builder) => {
      outputs.clear();
      htmlOutputs.clear();

      // Sequential builds prevent overlapping output directories from erasing earlier outputs.
      for (const name of [client, ...preloads]) {
        if (name === client && !renderers.length) continue;
        // eslint-disable-next-line no-await-in-loop
        await builder.build(builder.environments[name]);
      }

      generate();

      for (const [name, environment] of Object.entries(builder.environments)) {
        if (name !== client && !preloads.includes(name)) {
          // Plugins may enable Vite's default SSR environment just to configure
          // dependency handling. It has no entry and is not an application build.
          if (
            name === "ssr" &&
            !environment.config.input &&
            !environment.config.build.rolldownOptions.input &&
            typeof environment.config.build.ssr !== "string"
          )
            continue;
          // eslint-disable-next-line no-await-in-loop
          await builder.build(environment);
        }
      }
    },
    buildStart() {
      if (active && !server) collector.buildStart.call(this);
    },
    transform(code, id) {
      if (active && !server) {
        return collector.transform.call(this, code, id);
      }

      return null;
    },
    renderChunk(code, chunk, output) {
      if (active && !server) {
        return collector.renderChunk.call(this, code, chunk, output);
      }

      return null;
    },
    writeBundle(output, bundle) {
      if (active && !server) {
        collector.writeBundle.call(this, output, bundle);
      }
    },
  };
};
