// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import { createMemoryRouter, RouterProvider } from "react-router"
import { afterEach, describe, expect, it } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppLayout } from "@/routes/app-layout"
import { mockFetch } from "@/test/render"

afterEach(cleanup)

function renderApp(routes: Record<string, unknown>) {
  mockFetch(routes)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      { path: "/", element: <p>Home page</p> },
      {
        element: <AppLayout />,
        children: [{ path: "/sites", element: <p>Page content</p> }],
      },
    ],
    { initialEntries: ["/sites"] }
  )
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
  return { client, router }
}

const user = { login: "martin", provider: "github" }
const serverError = () =>
  new Response(JSON.stringify({ error: "boom" }), { status: 503 })

describe("AppLayout", () => {
  it("keeps the app when a background re-check of the user fails", async () => {
    const routes: Record<string, unknown> = {
      "/api/auth/me": user,
      "/api/sites": [],
    }
    const { client } = renderApp(routes)
    expect(await screen.findByText("Page content")).toBeTruthy()

    routes["/api/auth/me"] = serverError
    await act(() => client.refetchQueries({ queryKey: ["me"] }))
    expect(screen.getByText("Page content")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows the error when the first check fails", async () => {
    renderApp({ "/api/auth/me": serverError, "/api/sites": [] })
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not reach the server"
    )
    expect(screen.queryByText("Page content")).toBeNull()
  })

  it("sends a visitor without a session to the home page", async () => {
    const { router } = renderApp({
      "/api/auth/me": () =>
        new Response(JSON.stringify({ error: "not signed in" }), {
          status: 401,
        }),
    })
    expect(await screen.findByText("Home page")).toBeTruthy()
    expect(router.state.location.pathname).toBe("/")
  })
})
