// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { SitesPage } from "@/routes/sites"
import { renderApp } from "@/test/app"
import { site, stats } from "@/test/fixtures"

afterEach(cleanup)

const routes = () => ({
  "/api/sites": [
    site(),
    site({
      id: "new",
      name: "Shop",
      first_event_at: null,
      last_event_at: null,
    }),
  ],
  "/api/sites/abc/stats": stats(),
})

describe("SitesPage", () => {
  it("lists sites with their numbers under one heading", async () => {
    renderApp(<SitesPage />, routes(), "/sites")
    expect(await screen.findByText("Waiting for first event")).toBeTruthy()
    expect(await screen.findByText("100")).toBeTruthy()
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sites2")
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
  })

  it("switches the period, and the rows open the dashboard on it", async () => {
    const user = userEvent.setup()
    const { router, calls } = renderApp(<SitesPage />, routes(), "/sites")
    await screen.findByText("100")
    expect(
      screen.getByRole("link", { name: /Blog/ }).getAttribute("href")
    ).toBe("/sites/abc")

    await user.click(screen.getByRole("combobox", { name: "Period" }))
    await user.click(screen.getByRole("option", { name: "Last 30 days" }))
    await waitFor(() =>
      expect(router.state.location.search).toBe("?period=30d")
    )
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Blog/ }).getAttribute("href")
      ).toBe("/sites/abc?period=30d")
    )
    expect(
      calls.filter((c) => c.startsWith("/api/sites/abc/stats"))
    ).toHaveLength(2)
  })

  it("offers to add a site", async () => {
    renderApp(<SitesPage />, routes(), "/sites")
    expect(await screen.findByRole("button", { name: "Add site" })).toBeTruthy()
  })

  it("adds a site and lands on its dashboard, waiting for the first event", async () => {
    const user = userEvent.setup()
    let sent: unknown
    const r = routes()
    const { router } = renderApp(
      <SitesPage />,
      {
        ...r,
        "/api/sites": (init: RequestInit | undefined) => {
          if (init?.method === "POST") {
            sent = JSON.parse(String(init.body))
            return site({ id: "xyz", first_event_at: null })
          }
          return r["/api/sites"]
        },
      },
      "/sites?add=1"
    )
    await user.type(await screen.findByLabelText("Domain"), "docs.example")
    await user.click(screen.getByRole("button", { name: "Add site" }))
    await waitFor(() =>
      expect(
        router.state.location.pathname + router.state.location.search
      ).toBe("/sites/xyz?new=1")
    )
    expect(sent).toEqual({ name: "", domain: "docs.example" })
  })
})
