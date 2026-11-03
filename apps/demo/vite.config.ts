import { defineElectronConfig } from "@electron-spark/vite-config";
import { electronAppIdentity } from "@electron-spark/vite-plugin-electron-app-identity";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";
import reactPlugin from "@vitejs/plugin-react";

const routeTemplate = `%%tsrImports%%
import type { ReactNode } from "react";

const RouteComponent = (): ReactNode => <div>Hello "%%tsrPath%%"</div>;

%%tsrExportStart%%{
  component: RouteComponent,
}%%tsrExportEnd%%
`;

export default defineElectronConfig({
  // Workspace packages expose TypeScript source during development.
  externalDeps: { exclude: ["@electron-spark/ipc", "@electron-spark/store"] },
  vite: {
    plugins: [
      electronAppIdentity({ projectDir: import.meta.dirname }),
      {
        name: "development-content-security-policy",
        apply: "serve",
        transformIndexHtml(html) {
          return html.replace(
            /(<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content=")[^"]*(")/i,
            "$1default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'; form-action 'none';$2",
          );
        },
      },
      reactPlugin(),
      vanillaExtractPlugin(),
      tanstackRouter({
        customScaffolding: {
          lazyRouteTemplate: routeTemplate,
          routeTemplate,
        },
        generatedRouteTree: "./view/routeTree.generated.ts",
        quoteStyle: "double",
        routeFileIgnorePattern: "\\.css\\.ts$",
        routesDirectory: "./view/routes",
        target: "react",
      }),
    ],
  },
});
