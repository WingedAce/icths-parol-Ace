import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { router } from "./router";
import { ProjectProvider } from "./context/ProjectContext";
import SchoolCredit from "./components/SchoolCredit";
import { ensureSession } from "./lib/supabase";

import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "./index.css";

ensureSession().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ProjectProvider>
        <RouterProvider router={router} />
        <SchoolCredit />
      </ProjectProvider>
    </StrictMode>,
  );
});