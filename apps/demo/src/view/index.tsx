import React from "react";
import ReactDOM from "react-dom/client";

import { I18nProvider } from "./providers/I18nProvider";
import { RouterProvider } from "./providers/RouteProvider";

const body = document.querySelector("body");

if (body) {
  ReactDOM.createRoot(body).render(
    <React.StrictMode>
      <I18nProvider>
        <RouterProvider />
      </I18nProvider>
    </React.StrictMode>,
  );
} else {
  console.error("Error while mounting React app as no body element was found");
}
