import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import type { ReactElement } from "react"
import { createMemoryRouter, RouterProvider } from "react-router"

import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch } from "@/test/render"

/**
 * Renders `ui` at `url` under the app's providers (theme, tooltips, sidebar) with routes for
 * /sites and /sites/:id/*, so navigation inside the app can be followed.
 */
export function renderApp(
  ui: ReactElement,
  routes: Record<string, unknown>,
  url = "/sites/abc"
) {
  const calls = mockFetch(routes)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const page = (
    <ThemeProvider>
      <TooltipProvider>
        <SidebarProvider>{ui}</SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>Home page</p> },
      { path: "/sites", element: page },
      { path: "/sites/:id/*", element: page },
    ],
    { initialEntries: [url] }
  )
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { ...view, calls, client, router }
}
