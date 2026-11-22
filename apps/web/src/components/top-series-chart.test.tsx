// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { TopSeriesChart } from "@/components/top-series-chart"
import { METRIC } from "@/lib/metrics"
import { row, stats, summary } from "@/test/fixtures"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const rows = Array.from({ length: 7 }, (_, i) => row(`/p${i}`, 10 - i))
// Each value's own stats: visitors 10x the index, page views 100x.
const routes = {
  "/api/sites/abc/stats": (_: unknown, url: URL) => {
    const n = Number(url.searchParams.get("f")?.match(/p(\d)/)?.[1] ?? 0) + 1
    return stats({ summary: summary({ visitors: n * 10, pageviews: n * 100 }) })
  },
}

describe("TopSeriesChart", () => {
  it("draws the top five and names their totals for screen readers", async () => {
    const calls = mockFetch(routes)
    renderInSite((sc) => <TopSeriesChart sc={sc} dim="path" rows={rows} />)
    expect(
      await screen.findByText(
        "Visitors in this period: /p0 10, /p1 20, /p2 30, /p3 40, /p4 50."
      )
    ).toBeTruthy()
    expect(
      calls.filter((c) => c.startsWith("/api/sites/abc/stats"))
    ).toHaveLength(5)
    expect(screen.queryByText("/p5")).toBeNull()
  })

  it("charts the metric it is given", async () => {
    mockFetch(routes)
    renderInSite((sc) => (
      <TopSeriesChart
        sc={sc}
        dim="path"
        rows={rows.slice(0, 2)}
        metric={METRIC.pageviews}
      />
    ))
    expect(
      await screen.findByText("Page views in this period: /p0 100, /p1 200.")
    ).toBeTruthy()
  })

  it("says when there is nothing, and when it failed", async () => {
    mockFetch(routes)
    renderInSite((sc) => <TopSeriesChart sc={sc} dim="path" rows={[]} />)
    expect(await screen.findByText("Nothing in this period")).toBeTruthy()
    cleanup()

    mockFetch({
      "/api/sites/abc/stats": () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    })
    renderInSite((sc) => <TopSeriesChart sc={sc} dim="path" rows={rows} />)
    expect((await screen.findByRole("alert")).textContent).toContain("boom")
  })
})
