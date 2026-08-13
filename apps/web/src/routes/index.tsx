import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { ChatProvider } from "@/contexts/ChatContext";
import {
  ProjectsPage,
  ProjectDetailPage,
  RunDetailPage,
  FixPreviewPage,
  SettingsPage,
} from "@/pages";

// Headless mode: no auth routes, no ProtectedRoute. TED owns auth. The UI is a
// read-only viewer for scans, progress, findings, and dry-run reports.
export const router = createBrowserRouter(
  [
    // Standalone, chrome-free carousel opened by the TED "AI Fix" link. Kept
    // OUTSIDE AppLayout so it shows nothing of QACC.
    { path: "/fix-preview/:id", element: <FixPreviewPage /> },
    {
      element: (
        <ChatProvider>
          <AppLayout />
        </ChatProvider>
      ),
      children: [
        { path: "/", element: <Navigate to="/projects" replace /> },
        { path: "/projects", element: <ProjectsPage /> },
        { path: "/projects/:id", element: <ProjectDetailPage /> },
        { path: "/projects/:id/runs/:runId", element: <RunDetailPage /> },
        { path: "/settings", element: <SettingsPage /> },
        { path: "*", element: <Navigate to="/projects" replace /> },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
