import type { ReactNode } from "react";
import { Navigate, createBrowserRouter } from "react-router";

import App from "./App";
import DevPinGate from "./components/DevPinGate";
import DeveloperPage from "./pages/DeveloperPage";
import WorkspacePage from "./pages/WorkspacePage";
import { hasSessionPass } from "./utils/accessLock";

// Workspaces can only be reached through the title screen's color combo lock
// (typing or bookmarking a workspace URL sends you back to the title screen).
function RequireColorLock({ children }: { children: ReactNode }) {
  return hasSessionPass() ? <>{children}</> : <Navigate to="/" replace />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/developer",
    element: (
      <DevPinGate>
        <DeveloperPage />
      </DevPinGate>
    ),
  },
  {
    path: "/workspace/:workspaceId/*",
    element: (
      <RequireColorLock>
        <WorkspacePage />
      </RequireColorLock>
    ),
  },
]);
