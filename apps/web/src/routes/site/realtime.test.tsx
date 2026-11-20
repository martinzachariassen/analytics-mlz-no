// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { REALTIME_POLL_MS } from "@/lib/queries"
import { RealtimePage } from "@/routes/site/realtime"
import { row } from "@/test/fixtures"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const page = () => (
  <TooltipProvider>
    <RealtimePage />
  </TooltipProvider>
)

describe("RealtimePage", () => {
  it("stops loading and says so when the request fails", async () => {
    mockFetch({
      "/api/sites/abc/realtime": () =>
        new Response(JSON.stringify({ error: "database is busy" }), {
          status: 400,
        }),
    })
    const { container } = renderInSite(() => (
      <TooltipProvider>
        <RealtimePage />
      </TooltipProvider>
    ))
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toContain(
      "database is busy"
    )
    expect(screen.getByText("Not available")).toBeTruthy()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
})

describe("RealtimePage live data", () => {
  const live = (visitors: number) => ({
    visitors,
    minutes: [
      { t: "2026-11-12T10:00:00Z", visitors: 2, pageviews: 3 },
      { t: "2026-11-12T10:01:00Z", visitors: 1, pageviews: 4 },
    ],
    pages: [row("/pricing", 2), row("/", 1)],
    referrers: [row("news.example", 1)],
    countries: [row("NO", 2)],
  })

  it("shows who is here now and refreshes by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let visitors = 3
    const calls = mockFetch({ "/api/sites/abc/realtime": () => live(visitors) })
    renderInSite(page)

    expect(await screen.findByText("3")).toBeTruthy()
    // Page views over the last 30 minutes: 3 + 4.
    expect(screen.getByText("7")).toBeTruthy()
    // The top page tile and the first row of the pages list.
    expect(screen.getAllByTitle("/pricing")).toHaveLength(2)
    expect(screen.getByText("news.example")).toBeTruthy()

    visitors = 5
    await act(() => vi.advanceTimersByTimeAsync(REALTIME_POLL_MS))
    await waitFor(() => expect(screen.getByText("5")).toBeTruthy())
    expect(
      calls.filter((c) => c === "/api/sites/abc/realtime?detail=1").length
    ).toBeGreaterThan(1)
  })

  it("opens a row in the detail sheet", async () => {
    mockFetch({ "/api/sites/abc/realtime": live(1) })
    const { search } = renderInSite(page)
    await userEvent.click(
      await screen.findByRole("button", { name: /^\/pricing/ })
    )
    await waitFor(() => expect(search().get("detail")).toBe("path:/pricing"))
  })
})
