
import type { ReactNode } from "react";
import { Navigate, createBrowserRouter, useParams } from "react-router";

import App from "./App";
import AdminGate from "./components/AdminGate";
import DeveloperPage from "./pages/DeveloperPage";
import WorkspacePage from "./pages/WorkspacePage";
import { hasSessionPass } from "./utils/accessLock";

// Every group URL has its own color combo lock.
function RequireColorLock({ children }: { children: ReactNode }) {
  const { "*": nestedPath } = useParams();

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
      <AdminGate>
        <DeveloperPage />
      </AdminGate>
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
