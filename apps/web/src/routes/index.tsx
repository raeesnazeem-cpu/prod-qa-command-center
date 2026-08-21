import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { ChatProvider } from "@/contexts/ChatContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  LoginPage,
  ProjectsPage,
  ProjectDetailPage,
  RunDetailPage,
  FixPreviewPage,
  SettingsPage,
  SsoCallback,
} from "@/pages";

// TED owns authentication: "Continue with TED" (LoginPage) mints a signed SSO
// ticket that QACC's own backend verifies, establishing QACC's own
// qacc_session cookie (see apps/api/src/routes/auth.ts). ProtectedRoute gates
// everything except the login page, the TED SSO callback, and the standalone
// fix-preview link.
export const router = createBrowserRouter(
  [
    // Standalone, chrome-free carousel opened by the TED "AI Fix" link. Kept
    // OUTSIDE AppLayout so it shows nothing of QACC.
    { path: "/fix-preview/:id", element: <FixPreviewPage /> },
    { path: "/login", element: <LoginPage /> },
    // TED SSO landing (chrome-free): exchanges ?ted_sso=<ticket> for a
    // qacc_session cookie. See hooks/useQaccSession exchangeTedTicket.
    { path: "/sso", element: <SsoCallback /> },
    {
      element: <ProtectedRoute />,
      children: [
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
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
