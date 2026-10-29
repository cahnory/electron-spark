import { builtinModules } from "node:module";
import path from "node:path";

import { electronMain } from "@electron-start/vite-plugin-electron-main";
import { electronPreload } from "@electron-start/vite-plugin-electron-preload";
import {
  electronRenderer,
  discoverRendererHtml,
  readRendererWindow,
} from "@electron-start/vite-plugin-electron-renderer";
import {
  mergeConfig,
  type ConfigEnv,
  type EnvironmentOptions,
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
          input: mainEntry,
          build: {
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
      electronRenderer({
        electronEnvironment: "electron",
        clientEnvironment: "client",
        viewPatterns,
        htmlEntry,
        windowConfigPath: options?.windowConfigPath,
        rendererManifestPath: options?.rendererManifestPath,
      }),
      ...Object.keys(preloadEnvironments).flatMap((preloadEnv) => electronPreload(preloadEnv)),
      electronMain(),
    ],
    root: path.relative(process.cwd(), srcDir),
  };

  config = customize(config, options.vite, context);

  if (debug) {
    console.dir(config, { depth: null, colors: true });
  }

  return config;
};
