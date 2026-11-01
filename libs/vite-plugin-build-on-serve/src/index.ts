import {
  createBuilder,
  mergeConfig,
  perEnvironmentPlugin,
  type BuildEnvironmentOptions,
  type Plugin,
  type PluginOption,
  type Environment,
  type ViteDevServer,
} from "vite";

export type BuildOnServeSession = {
  plugins?: PluginOption[];
  /** Called once per watch cycle, before any outputs are built. */
  buildStart?(): void;
  /** Called once after all outputs in a watch cycle succeed. */
  buildSuccess?(): void | Promise<void>;
  close(): Promise<void>;
};

export type BuildOnServeOptions = {
  /** Additional build options for the watched environment. */
  build?: BuildEnvironmentOptions;
  /** Plugins applied only to this environment's watched build. */
  plugins?: PluginOption[] | ((server: ViteDevServer) => PluginOption[]);
  /** Resources created once the HTTP server starts listening, closed with its build. */
  session?: (server: ViteDevServer) => BuildOnServeSession;
};

// Config bundling can load multiple copies of this module; the server owns the shared state.
const prerequisitesKey = Symbol.for("@electron-start/build-on-serve/prerequisites");
type CoordinatedServer = ViteDevServer & {
  [prerequisitesKey]?: Map<string, Promise<void>[]>;
};

/** Delay creation of a watched build until another plugin has prepared its inputs. */
export function waitForBuildOnServe(server: ViteDevServer, name: string, ready: Promise<void>) {
  const environments = ((server as CoordinatedServer)[prerequisitesKey] ??= new Map());
  environments.set(name, [...(environments.get(name) ?? []), ready]);
}

/** Build one environment after standalone `vite serve` starts listening. */
export function buildOnServe(environmentName: string, options: BuildOnServeOptions = {}): Plugin {
  const sessions = new WeakMap<Environment, { close(): Promise<void> }>();
  return {
    name: `@electron-start/vite-plugin-build-on-serve:${environmentName}`,
    apply: "serve",
    configureServer(server) {
      const environment = server.environments[environmentName];
      if (!environment) throw new Error(`Unknown build-on-serve environment: ${environmentName}`);
      if (!server.httpServer) {
        throw new Error("buildOnServe requires Vite's standalone HTTP server.");
      }
      sessions.set(environment, createServeSession(server, environmentName, options));
    },
    async closeBundle() {
      const session = sessions.get(this.environment);
      try {
        await session?.close();
      } finally {
        sessions.delete(this.environment);
      }
    },
  };
}

const createServeSession = (server: ViteDevServer, name: string, options: BuildOnServeOptions) => {
  const httpServer = server.httpServer!;
  let resource: BuildOnServeSession | undefined;
  let watcher: { close(): Promise<void> } | undefined;
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const stopped = Promise.withResolvers<void>();

  function close() {
    httpServer.off("listening", start);
    stopped.resolve();
    closing ??= (async () => {
      try {
        await resource?.close();
      } finally {
        await starting?.catch(() => {});
        await watcher?.close();
      }
    })();
    return closing;
  }

  function start() {
    if (closing || starting) return;
    starting = (async () => {
      resource = options.session?.(server);
      const plugins =
        typeof options.plugins === "function" ? options.plugins(server) : options.plugins;
      watcher = await startWatchedBuild(
        server,
        name,
        options,
        {
          ...resource,
          plugins: [...(plugins ?? []), ...(resource?.plugins ?? [])],
        },
        stopped.promise,
      );
    })();
    void starting.catch(async (error: unknown) => {
      try {
        await close();
      } catch (cleanupError) {
        server.config.logger.error(String(cleanupError));
      }
      server.config.logger.error(`build-on-serve:${name}: ${String(error)}`);
    });
  }

  // HTTP listening follows successful initialization of every dev environment.
  httpServer.once("listening", start);
  return { close };
};

const startWatchedBuild = async (
  server: ViteDevServer,
  environmentName: string,
  options: BuildOnServeOptions,
  session: Omit<BuildOnServeSession, "close">,
  stopped: Promise<void>,
): Promise<{ close(): Promise<void> } | undefined> => {
  const ready = await Promise.race([
    Promise.all((server as CoordinatedServer)[prerequisitesKey]?.get(environmentName) ?? []).then(
      () => true,
    ),
    stopped.then(() => false),
  ]);
  if (!ready) return undefined;
  // A dev server has no builder. Resolve a separate build config, preserving
  // both file-based configuration and overrides passed to createServer().
  const builder = await createBuilder(
    mergeConfig(server.config.inlineConfig, {
      configFile: server.config.configFile ?? false,
      mode: server.config.mode,
      root: server.config.root,
      environments: {
        [environmentName]: {
          build: { ...options.build, watch: options.build?.watch || {} },
        },
      },
      plugins: [
        perEnvironmentPlugin(
          `build-on-serve-plugins:${environmentName}`,
          (environment) => environment.name === environmentName && session.plugins,
        ),
      ],
    }),
  );
  const environment = builder.environments[environmentName];
  if (!environment) {
    throw new Error(`Unknown build environment: ${environmentName}`);
  }

  const result = await builder.build(environment);
  if (!("close" in result)) throw new Error("Build-on-serve requires watch mode.");
  // Rolldown returns its emitter before installing the actual close method.
  // Its first event is emitted only after the native watcher exists.
  const initialized = Promise.withResolvers<void>();
  let closing: Promise<void> | undefined;
  let failed = false;
  result.on("event", async (event) => {
    initialized.resolve();
    if (closing) return;
    try {
      if (event.code === "START") {
        failed = false;
        session.buildStart?.();
      } else if (event.code === "ERROR") {
        failed = true;
      } else if (event.code === "END" && !failed) {
        await session.buildSuccess?.();
      }
    } catch (error) {
      failed = true;
      server.config.logger.error(`build-on-serve:${environmentName}: ${String(error)}`);
    }
  });
  return {
    close() {
      closing ??= (async () => {
        await initialized.promise;
        await result.close();
      })();
      return closing;
    },
  };
};
