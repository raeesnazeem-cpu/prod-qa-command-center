import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppLayout } from "@/layouts/AppLayout"
import { ChatProvider } from "@/contexts/ChatContext"
import { ProtectedRoute } from "@/components/ProtectedRoute"
import {
  LoginPage,
  RegisterPage,
  DashboardPage,
  ProjectsPage,
  ProjectDetailPage,
  RunDetailPage,
  SettingsPage,
  TasksPage,
  TeamPage,
  OnboardingPage,
  TestPage,
  VisualDiffPage,
  Week1TestPage,
  Week2TestPage,
  QueueHistoryPage,
  ActivityLogPage,
  StatsPage,
  AllTasksPage,
  FeedbackPage,
} from "@/pages"
import { AuthenticateWithRedirectCallback } from "@clerk/react"

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <Navigate to="/dashboard" replace />,
    },
    {
      path: "/login",
      children: [
        {
          index: true,
          element: <LoginPage />,
        },
        {
          path: "*",
          element: <LoginPage />,
        },
      ],
    },
    {
      path: "/register",
      children: [
        {
          index: true,
          element: <RegisterPage />,
        },
        {
          path: "*",
          element: <RegisterPage />,
        },
      ],
    },
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
            {
              path: "/onboarding",
              element: <OnboardingPage />,
            },
            {
              path: "/dashboard",
              element: <DashboardPage />,
            },
            {
              path: "/test",
              element: <TestPage />,
            },
            {
              path: "/week1-test",
              element: <Week1TestPage />,
            },
            {
              path: "/week2-test",
              element: <Week2TestPage />,
            },
            {
              path: "/sso-callback",
              element: <AuthenticateWithRedirectCallback />,
            },
            // If Clerk is specifically sending to /login/sso-callback, use this:
            {
              path: "/login/sso-callback",
              element: <AuthenticateWithRedirectCallback />,
            },

            {
              path: "/projects",
              element: <ProjectsPage />,
            },
            {
              path: "/projects/:id",
              element: <ProjectDetailPage />,
            },
            {
              path: "/projects/:id/runs/:runId",
              element: <RunDetailPage />,
            },
            {
              path: "/projects/:id/runs/:runId/diff",
              element: <VisualDiffPage />,
            },
            {
              path: "/tasks",
              element: <TasksPage />,
            },
            {
              path: "/all-tasks",
              element: <AllTasksPage />,
            },
            {
              path: "/settings",
              element: <SettingsPage />,
            },
            {
              path: "/team",
              element: <TeamPage />,
            },
            {
              path: "/team",
              element: <TeamPage />,
            },
            {
              path: "/stats",
              element: <StatsPage />,
            },

            {
              path: "/admin/queue-history",
              element: <QueueHistoryPage />,
            },
            {
              path: "/admin/activity-logs",
              element: <ActivityLogPage />,
            },
            {
              path: "/feedback",
              element: <FeedbackPage />,
            },
          ],
        },
      ],
    },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  },
)
