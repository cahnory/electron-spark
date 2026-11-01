import {
  RouterProvider as TanstackRouterProvider,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import { routeTree } from "../routeTree.generated";

export const router = createRouter({ history: createHashHistory(), routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export const RouterProvider = (): ReactNode => <TanstackRouterProvider router={router} />;
