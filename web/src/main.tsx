import { lazy, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createBrowserRouter, Navigate, RouterProvider } from "react-router"

import "./index.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { ApiError } from "@/lib/api"
import { AppLayout } from "@/routes/app-layout"
import { HomePage } from "@/routes/home"
import { SitesPage } from "@/routes/sites"

// Charts (Recharts) are the bulk of the bundle; load them only when needed.
const DashboardPage = lazy(() =>
  import("@/routes/dashboard").then((m) => ({ default: m.DashboardPage }))
)
const SettingsPage = lazy(() =>
  import("@/routes/settings").then((m) => ({ default: m.SettingsPage }))
)

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // A 401 anywhere means the session ended: re-check who we are, which redirects home.
    // Not for the "me" query itself: re-checking it on its own 401 would loop forever,
    // and the page would never leave its loading state.
    onError: (err, query) => {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        query.queryKey[0] !== "me"
      ) {
        void queryClient.invalidateQueries({ queryKey: ["me"] })
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // The API is same-origin (often localhost). Don't pause requests when the browser
      // thinks it is offline (VPNs, extensions); just try, and show an error if it fails.
      networkMode: "always",
      retry: (count, err) =>
        !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
})

const router = createBrowserRouter([
  // Public: what this is, and sign-in. Signed-in visitors go on to /sites.
  { path: "/", element: <HomePage /> },
  { path: "/login", element: <Navigate to="/" replace /> },
  {
    element: <AppLayout />,
    children: [
      { path: "/sites", element: <SitesPage /> },
      { path: "/sites/:id", element: <DashboardPage /> },
      { path: "/sites/:id/settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/sites" replace /> },
    ],
  },
])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
