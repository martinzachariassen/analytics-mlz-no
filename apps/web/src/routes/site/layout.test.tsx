// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SidebarProvider } from "@/components/ui/sidebar"
import type { Site } from "@/lib/api"
import { WAITING_POLL_MS } from "@/lib/queries"
import { SiteLayout } from "@/routes/site/layout"
import { mockFetch, renderInSite } from "@/test/render"

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }))

const waiting: Site = {
  id: "abc",
  name: "Blog",
  domain: "blog.example",
  created_at: "2026-11-12T10:00:00Z",
  first_event_at: null,
  last_event_at: null,
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.mocked(toast.success).mockClear()
})

const layout = () => (
  <SidebarProvider>
    <SiteLayout />
  </SidebarProvider>
)

describe("SiteLayout onboarding", () => {
  it("shows the snippet instead of the dashboard until the first event, then switches by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    // Within the first hour after the site was added, so it polls fast.
    vi.setSystemTime(new Date("2026-11-12T10:01:00Z"))
    const routes: Record<string, unknown> = { "/api/sites/abc": waiting }
    const calls = mockFetch(routes)
    renderInSite(() => (
      <SidebarProvider>
        <SiteLayout />
      </SidebarProvider>
    ))

    expect((await screen.findByRole("status")).textContent).toContain(
      "Waiting for the first event"
    )
    expect(screen.getByText(/data-site="abc"/)).toBeTruthy()
    expect(screen.getByText(/only accepted from blog\.example/)).toBeTruthy()
    // No period picker or filters: there is nothing to scope yet.
    expect(screen.queryByRole("button", { name: /filter/i })).toBeNull()
    expect(calls.some((c) => c.includes("/stats"))).toBe(false)

    routes["/api/sites/abc"] = {
      ...waiting,
      first_event_at: "2026-11-12T10:05:00Z",
      last_event_at: "2026-11-12T10:05:00Z",
    }
    await act(() => vi.advanceTimersByTimeAsync(WAITING_POLL_MS))
    await waitFor(() =>
      expect(screen.queryByText(/Waiting for the first event/)).toBeNull()
    )
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it("does not announce a first event when switching to a site that already has data", async () => {
    const calls = mockFetch({
      "/api/sites/abc": waiting,
      "/api/sites/xyz": {
        ...waiting,
        id: "xyz",
        name: "Docs",
        first_event_at: "2026-11-01T00:00:00Z",
        last_event_at: "2026-11-12T09:00:00Z",
      },
    })
    // The layout stays mounted across sites; xyz is cached when the sidebar returns to it.
    const { router } = renderInSite(layout, "/sites/xyz")
    await waitFor(() => expect(calls).toContain("/api/sites/xyz"))
    await act(() => router.navigate("/sites/abc"))
    await screen.findByText(/Waiting for the first event/)
    await act(() => router.navigate("/sites/xyz"))
    await waitFor(() =>
      expect(screen.queryByText(/Waiting for the first event/)).toBeNull()
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("does not poll a site that has data", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = mockFetch({
      "/api/sites/abc": {
        ...waiting,
        first_event_at: "2026-11-01T00:00:00Z",
        last_event_at: "2026-11-12T09:00:00Z",
      },
    })
    renderInSite(() => (
      <SidebarProvider>
        <SiteLayout />
      </SidebarProvider>
    ))
    await waitFor(() => expect(calls).toContain("/api/sites/abc"))
    await act(() => vi.advanceTimersByTimeAsync(WAITING_POLL_MS * 3))
    expect(calls.filter((c) => c === "/api/sites/abc")).toHaveLength(1)
    expect(screen.queryByText(/Waiting for the first event/)).toBeNull()
  })

  it("names the browser tab after the view and the site", async () => {
    mockFetch({
      "/api/sites/abc": {
        ...waiting,
        first_event_at: "2026-11-01T00:00:00Z",
        last_event_at: "2026-11-12T09:00:00Z",
      },
    })
    const { unmount } = renderInSite(layout)
    await waitFor(() =>
      expect(document.title).toBe("Overview · Blog · mlz. analytics")
    )
    unmount()
    expect(document.title).toBe("mlz. analytics")
  })
})
