import { createBrowserRouter } from "react-router";

import App from "./App";
import WorkspacePage from "./pages/WorkspacePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
  },
  {
    path: "/workspace/:workspaceId/*",
    element: <WorkspacePage />,
  },
]);