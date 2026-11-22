// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppSidebar } from "@/components/app-sidebar"
import { RealtimePage } from "@/routes/site/realtime"
import { renderApp } from "@/test/app"
import { githubUser, site } from "@/test/fixtures"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const assign = vi.fn()
const realLocation = window.location
beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, assign },
  })
})
afterEach(() => {
  cleanup()
  assign.mockClear()
  vi.mocked(toast.error).mockClear()
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  })
  localStorage.clear()
})

const routes = (over: Record<string, unknown> = {}) => ({
  "/api/sites": [site()],
  "/api/sites/abc/realtime": { visitors: 3 },
  ...over,
})

const sidebar = (user = githubUser, onShortcuts = () => {}) => (
  <AppSidebar user={user} onSearch={() => {}} onShortcuts={onShortcuts} />
)

async function openUserMenu(login: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: new RegExp(login) })
  )
}

describe("AppSidebar", () => {
  it("signs out and leaves the app", async () => {
    let method: string | undefined
    renderApp(
      sidebar(),
      routes({
        "/api/auth/logout": (init: RequestInit | undefined) => {
          method = init?.method
          return new Response(null, { status: 204 })
        },
      })
    )
    await openUserMenu("martin")
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"))
    expect(method).toBe("POST")
  })

  it("keeps the user signed in when signing out fails", async () => {
    renderApp(
      sidebar(),
      routes({
        "/api/auth/logout": () =>
          new Response(JSON.stringify({ error: "server is down" }), {
            status: 503,
          }),
      })
    )
    await openUserMenu("martin")
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("server is down")
    )
    expect(assign).not.toHaveBeenCalled()
  })

  it("toggles the theme from the user menu", async () => {
    renderApp(sidebar(), routes())
    await openUserMenu("martin")
    await userEvent.click(screen.getByRole("menuitem", { name: /Light mode/ }))
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("light")
    )
    expect(localStorage.getItem("theme")).toBe("light")
    await openUserMenu("martin")
    expect(screen.getByRole("menuitem", { name: /Dark mode/ })).toBeTruthy()
  })

  it("opens the keyboard shortcuts from the user menu", async () => {
    const onShortcuts = vi.fn()
    renderApp(sidebar(githubUser, onShortcuts), routes())
    await openUserMenu("martin")
    await userEvent.click(
      screen.getByRole("menuitem", { name: /Keyboard shortcuts/ })
    )
    expect(onShortcuts).toHaveBeenCalled()
  })

  it("offers add site to a signed-in user", async () => {
    const { router } = renderApp(
      sidebar(),
      routes({ "/api/auth/me": githubUser })
    )
    await userEvent.click(await screen.findByRole("button", { name: /Blog/ }))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Add site" })
    )
    await waitFor(() =>
      expect(
        router.state.location.pathname + router.state.location.search
      ).toBe("/sites?add=1")
    )
  })

  it("shows the live count, and polls only once on the Realtime page", async () => {
    const { calls } = renderApp(
      <>
        {sidebar()}
        <RealtimePage />
      </>,
      routes(),
      "/sites/abc/realtime"
    )
    expect(await screen.findByText("Visitors now")).toBeTruthy()
    await waitFor(() =>
      expect(screen.getAllByText("3").length).toBeGreaterThan(1)
    )
    expect(
      calls.filter((c) => c.startsWith("/api/sites/abc/realtime"))
    ).toEqual(["/api/sites/abc/realtime?detail=1"])
  })
})
