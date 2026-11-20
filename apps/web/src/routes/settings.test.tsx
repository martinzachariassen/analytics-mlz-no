// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createMemoryRouter, RouterProvider } from "react-router"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SettingsPage } from "@/routes/settings"
import { site } from "@/test/fixtures"
import { mockFetch } from "@/test/render"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.mocked(toast.success).mockClear()
})

function renderSettings(
  routes: Record<string, unknown>,
  url = "/sites/abc/settings"
) {
  const calls = mockFetch(routes)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter(
    [
      { path: "/sites", element: <p>All sites</p> },
      { path: "/sites/:id/settings", element: <SettingsPage /> },
    ],
    { initialEntries: [url] }
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { calls, client, router }
}

const base = {
  "/api/sites/abc/goals": [],
}

describe("SettingsPage", () => {
  it("renames the site and updates the cached site", async () => {
    let sent: unknown
    const { client } = renderSettings({
      ...base,
      "/api/sites/abc": (init: RequestInit | undefined) => {
        if (init?.method === "PATCH") {
          sent = JSON.parse(String(init.body))
          return site({ name: "Diary", domain: "diary.example" })
        }
        return site()
      },
    })
    const user = userEvent.setup()
    const name = await screen.findByLabelText("Name")
    await user.clear(name)
    await user.type(name, "Diary")
    const domain = screen.getByLabelText("Domain")
    await user.clear(domain)
    await user.type(domain, "diary.example")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(sent).toEqual({ name: "Diary", domain: "diary.example" })
    )
    expect(toast.success).toHaveBeenCalledWith("Site updated")
    expect(client.getQueryData(["site", "abc"])).toMatchObject({
      name: "Diary",
    })
  })

  it("shows why a rename was refused", async () => {
    renderSettings({
      ...base,
      "/api/sites/abc": (init: RequestInit | undefined) =>
        init?.method === "PATCH"
          ? new Response(JSON.stringify({ error: "domain already in use" }), {
              status: 409,
            })
          : site(),
    })
    await userEvent.click(await screen.findByRole("button", { name: "Save" }))
    expect(await screen.findByText("domain already in use")).toBeTruthy()
  })

  it("deletes the site only after confirming, then goes to the site list", async () => {
    const methods: string[] = []
    const { router } = renderSettings({
      ...base,
      "/api/sites": [],
      "/api/sites/abc": (init: RequestInit | undefined) => {
        methods.push(init?.method ?? "GET")
        return init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : site()
      },
    })
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "Delete site" }))
    expect(
      screen.getByRole("alertdialog", { name: "Delete Blog?" })
    ).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(methods).not.toContain("DELETE")
    expect(router.state.location.pathname).toBe("/sites/abc/settings")

    await user.click(screen.getByRole("button", { name: "Delete site" }))
    await user.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(router.state.location.pathname).toBe("/sites"))
    expect(methods).toContain("DELETE")
    expect(toast.success).toHaveBeenCalledWith("Deleted Blog")
  })

  it("lists its sections and links to each one", async () => {
    const { router } = renderSettings({
      ...base,
      "/api/sites/abc": site(),
    })
    const nav = await screen.findByRole("navigation", { name: "Settings" })
    const links = Array.from(nav.querySelectorAll("a")).map(
      (a) => a.textContent
    )
    expect(links).toEqual([
      "Tracking code",
      "Tracking pixel",
      "Goals",
      "General",
      "Delete site",
    ])
    expect(
      screen
        .getByRole("link", { name: "Tracking code" })
        .getAttribute("aria-current")
    ).toBe("location")

    await userEvent.click(screen.getByRole("link", { name: "Goals" }))
    await waitFor(() => expect(router.state.location.hash).toBe("#goals"))
    expect(
      screen.getByRole("link", { name: "Goals" }).getAttribute("aria-current")
    ).toBe("location")
    expect(document.getElementById("goals")).toBeTruthy()
  })

  it("says it is waiting while the site has no events", async () => {
    renderSettings({
      ...base,
      "/api/sites/abc": site({ first_event_at: null, last_event_at: null }),
    })
    expect((await screen.findByRole("status")).textContent).toContain(
      "Waiting for the first event"
    )
  })
})
