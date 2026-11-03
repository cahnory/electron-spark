import { lstat, readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";

import { electronMain } from "@electron-spark/vite-plugin-electron-main";
import { electronPreload } from "@electron-spark/vite-plugin-electron-preload";
import {
  electronRenderer,
  discoverRendererHtml,
  readRendererWindow,
} from "@electron-spark/vite-plugin-electron-renderer";
import { esmShim } from "@electron-spark/vite-plugin-esm-shim";
import { externalDeps, type ExternalDepsOptions } from "@electron-spark/vite-plugin-external-deps";
import {
  mergeConfig,
  type ConfigEnv,
  type EnvironmentOptions,
  type Plugin,
  type UserConfig,
  type UserConfigFnObject,
} from "vite";

/** Objects merge with defaults; callbacks mutate the generated config in place. */
export type ConfigOverride<T, Context = ConfigEnv> = T | ((config: T, context: Context) => void);

export type PreloadContext = ConfigEnv & {
  /** Preload entry relative to srcDir. */
  entry: string;
};

export type ElectronConfigOptions = {
  /** Applied last, after the named environment overrides. */
  vite?: ConfigOverride<UserConfig> | undefined;
  main?: ConfigOverride<EnvironmentOptions> | undefined;
  renderer?: ConfigOverride<EnvironmentOptions> | undefined;
  /** Applied separately to every unique discovered preload entry. */
  preload?: ConfigOverride<EnvironmentOptions, PreloadContext> | undefined;
  /** Main-process dependency policy. Set false to bundle dependencies. */
  externalDeps?: false | Pick<ExternalDepsOptions, "include" | "exclude"> | undefined;
  /** Supply CommonJS bindings in main-process ESM chunks. */
  esmShim?: boolean | undefined;
  debug?: boolean | undefined;
  /** HTML entry path, relative to each matched view directory. */
  htmlEntry?: string | undefined;
  /** Main entry path, relative to srcDir. */
  mainEntry?: string | undefined;
  /** View directory paths or glob patterns, relative to srcDir. */
  viewPatterns?: string | readonly string[] | undefined;
  /** Generated renderer module path, relative to the main entry's directory. */
  rendererManifestPath?: string | undefined;
  /** Window configuration path, relative to each HTML entry directory. */
  windowConfigPath?: string | undefined;
  srcDir?: string | undefined;
  outDir?: string | undefined;
  /** Base for srcDir and outDir, relative to the current working directory. */
  projectDir?: string | undefined;
};

const DEFAULT_CONFIG_OPTIONS = {
  debug: false,
  htmlEntry: "index.html",
  mainEntry: "main/index.ts",
  viewPatterns: ["view", "views/*"],
  srcDir: "src",
  outDir: "dist",
} as const satisfies ElectronConfigOptions;

/** Public config function type, nameable through this package during declaration emit. */
export interface ElectronConfig extends UserConfigFnObject {}

/** Generate a fresh configuration when Vite evaluates its config file. */
export const defineElectronConfig = (options: ElectronConfigOptions = {}): ElectronConfig => {
  return (context) => makeConfig(options, context);
};

const customize = <Context>(
  config: UserConfig & EnvironmentOptions,
  override: ConfigOverride<UserConfig & EnvironmentOptions, Context> | undefined,
  context: Context,
  environment = false,
): UserConfig & EnvironmentOptions => {
  if (typeof override === "function") {
    override(config, context);
    return config;
  }

  if (override) {
    // Wrap environments so Vite applies its normal environment merge semantics.
    return environment
      ? mergeConfig({ environments: { target: config } }, { environments: { target: override } })
          .environments.target
      : mergeConfig(config, override);
  }

  return config;
};

const makeConfig = (options: ElectronConfigOptions, context: ConfigEnv): UserConfig => {
  const debug = options?.debug ?? DEFAULT_CONFIG_OPTIONS.debug;
  const projectDir = options?.projectDir
    ? path.resolve(process.cwd(), options.projectDir)
    : process.cwd();
  const srcDir = path.resolve(projectDir, options?.srcDir ?? DEFAULT_CONFIG_OPTIONS.srcDir);
  const outDir = path.resolve(projectDir, options?.outDir ?? DEFAULT_CONFIG_OPTIONS.outDir);
  const viewPatterns = ([] as readonly string[]).concat(
    options?.viewPatterns ?? DEFAULT_CONFIG_OPTIONS.viewPatterns,
  );
  const htmlEntry = options?.htmlEntry ?? DEFAULT_CONFIG_OPTIONS.htmlEntry;
  const mainEntry = path.relative(
    srcDir,
    path.resolve(srcDir, options?.mainEntry ?? DEFAULT_CONFIG_OPTIONS.mainEntry),
  );

  const { htmlInput, preloadInput } = discoverRendererHtml(srcDir, viewPatterns, htmlEntry).reduce<{
    htmlInput: string[];
    preloadInput: string[];
  }>(
    (res, htmlFile) => {
      res.htmlInput.push(path.relative(srcDir, htmlFile));

      const { preload: preloadFile } = readRendererWindow(htmlFile, options?.windowConfigPath);
      if (preloadFile) {
        res.preloadInput.push(path.relative(srcDir, preloadFile));
      }
      return res;
    },
    { htmlInput: [], preloadInput: [] },
  );

  // Separate environments keep each BrowserWindow preload self-contained.
  // Renderer imports read the exports exposed by the matching preload.
  const preloadEnvironments = Object.fromEntries(
    [...new Set(preloadInput)].map((preload, index) => {
      const entry = preload.startsWith(`..${path.sep}`)
        ? `external/preload${index}${path.extname(preload)}`
        : preload;
      const output = path.join("preload", entry.slice(0, -path.extname(entry).length));
      return [
        `preload${index}`,
        customize<PreloadContext>(
          {
            consumer: "server",
            input: preload,
            build: {
              ssr: true,
              // The client build cleans dist; preload outputs may share a directory.
              emptyOutDir: false,
              copyPublicDir: false,
              outDir: path.relative(srcDir, path.resolve(outDir, path.dirname(output))),
              rolldownOptions: {
                external: ["electron", /^electron\//, ...builtinModules, /^node:/],
                output: {
                  format: "cjs",
                  entryFileNames: `${path.basename(output)}.cjs`,
                  codeSplitting: false,
                },
              },
            },
            resolve: { noExternal: true },
          },
          options.preload,
          { ...context, entry: preload },
          true,
        ),
      ];
    }),
  );

  let config: UserConfig = {
    base: "./",
    builder: {},
    environments: {
      // Clean the output directory before building main and preload files.
      client: customize<ConfigEnv>(
        {
          input: htmlInput,
          build: {
            emptyOutDir: true,
            outDir: path.relative(srcDir, outDir),
          },
        },
        options.renderer,
        context,
        true,
      ),
      electron: customize<ConfigEnv>(
        {
          consumer: "server",
          resolve: { noExternal: true },
          input: mainEntry,
          build: {
            copyPublicDir: false,
            emitAssets: true,
            emptyOutDir: true,
            outDir: path.relative(srcDir, path.resolve(outDir, "main")),
            ssr: true,
          },
        },
        options.main,
        context,
        true,
      ),
      ...preloadEnvironments,
    },
    plugins: [
      mainResources(path.join(srcDir, "resources")),
      electronRenderer({
        electronEnvironment: "electron",
        clientEnvironment: "client",
        viewPatterns,
        htmlEntry,
        windowConfigPath: options?.windowConfigPath,
        rendererManifestPath: options?.rendererManifestPath,
      }),
      ...Object.keys(preloadEnvironments).flatMap((preloadEnv) => electronPreload(preloadEnv)),
      options.externalDeps === false
        ? []
        : externalDeps({ ...options.externalDeps, projectDir, environment: "electron" }),
      options.esmShim === false ? [] : esmShim({ environment: "electron" }),
      electronMain(),
    ],
    root: path.relative(process.cwd(), srcDir),
    server: { fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/resources/**"] } },
  };

  config = customize(config, options.vite, context);

  if (debug) {
    console.dir(config, { depth: null, colors: true });
  }

  return config;
};

/** Emit private filesystem assets beside the main bundle in every build. */
function mainResources(directory: string): Plugin {
  return {
    name: "electron-main-resources",
    applyToEnvironment: (environment) => environment.name === "electron",
    async buildStart() {
      this.addWatchFile(directory);
      const root = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!root) return;
      if (root.isSymbolicLink()) this.error(`Resource symlinks are unsupported: ${directory}`);
      const visit = async (dir: string): Promise<void> => {
        this.addWatchFile(dir);
        await Promise.all(
          (await readdir(dir, { withFileTypes: true })).map(async (entry) => {
            const file = path.join(dir, entry.name);
            if (entry.isSymbolicLink()) this.error(`Resource symlinks are unsupported: ${file}`);
            if (entry.isDirectory()) await visit(file);
            else if (entry.isFile()) {
              this.addWatchFile(file);
              this.emitFile({
                type: "asset",
                fileName: `resources/${path.relative(directory, file).split(path.sep).join("/")}`,
                source: await readFile(file),
              });
            }
          }),
        );
      };
      await visit(directory);
    },
  };
}
