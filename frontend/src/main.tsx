import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";

import { router } from "./router";
import { ProjectProvider } from "./context/ProjectContext";
import SchoolCredit from "./components/SchoolCredit";
import { ensureSession } from "./lib/supabase";

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