import { createBrowserRouter } from "react-router";

import App from "./App";
import DeveloperPage from "./pages/DeveloperPage";
import WorkspacePage from "./pages/WorkspacePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/developer",
    element: <DeveloperPage />,
  },
  {
    path: "/workspace/:workspaceId/*",
    element: <WorkspacePage />,
  },
]);