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
