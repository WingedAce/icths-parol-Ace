import type { ReactNode } from "react";
import { Navigate, createBrowserRouter, useParams } from "react-router";

import App from "./App";
import DevPinGate from "./components/DevPinGate";
import DeveloperPage from "./pages/DeveloperPage";
import WorkspacePage from "./pages/WorkspacePage";
import { hasSessionPass } from "./utils/accessLock";

// Every group URL has its own color combo lock. A workspace page opens only
// if that group's lock was passed in this tab; typing or bookmarking a URL (or
// browsing up to a section/batch list) sends you back to the title screen.
function RequireColorLock({ children }: { children: ReactNode }) {
  const { "*": nestedPath } = useParams();

  // /workspace/<batch>/<section>/<group>/...  ->  the group is the 2nd id of
  // the splat.
  const groupId = (nestedPath ?? "")
    .split("/")
    .filter((id) => id.length > 0)[1];

  return groupId && hasSessionPass(groupId) ? (
    <>{children}</>
  ) : (
    <Navigate to="/" replace />
  );
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
