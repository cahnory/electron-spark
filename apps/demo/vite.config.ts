import { defineElectronConfig } from "@electron-start/vite-config";
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
  vite: {
    plugins: [
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
