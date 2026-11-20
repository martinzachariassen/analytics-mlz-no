// @vitest-environment happy-dom
import { cleanup, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Insights } from "@/components/insights"
import { row, stats, summary } from "@/test/fixtures"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const referrers = {
  "/api/sites/abc/breakdown": [row(""), row("news.example", 40)],
}

describe("Insights", () => {
  it("says how visitors changed, the top referrer and the busiest day", async () => {
    mockFetch(referrers)
    const { container } = renderInSite(() => <Insights stats={stats()} />)
    await screen.findByText("news.example")
    expect(container.textContent).toContain("Visitors are up 25%.")
    expect(container.textContent).toContain(
      "news.example is the top referrer (40% of visitors)."
    )
    expect(container.textContent).toMatch(
      /Busiest was Monday 2 Nov with 50 visitors/
    )
  })

  it("calls a small change flat, and a drop a drop", async () => {
    mockFetch(referrers)
    const { container, unmount } = renderInSite(() => (
      <Insights stats={stats({ previous: summary({ visitors: 99 }) })} />
    ))
    await screen.findByText("news.example")
    expect(container.textContent).toContain("Visitors are flat")
    unmount()

    mockFetch(referrers)
    const view = renderInSite(() => (
      <Insights stats={stats({ previous: summary({ visitors: 200 }) })} />
    ))
    await screen.findByText("news.example")
    expect(view.container.textContent).toContain("Visitors are down 50%.")
  })

  it("leaves the change out without a comparison, and says nothing without visitors", async () => {
    mockFetch(referrers)
    const { container, unmount } = renderInSite(
      () => <Insights stats={stats()} />,
      "/sites/abc?compare=off"
    )
    await screen.findByText("news.example")
    expect(container.textContent).not.toContain("Visitors are")
    unmount()

    mockFetch(referrers)
    const empty = renderInSite(() => (
      <Insights stats={stats({ summary: summary() })} />
    ))
    await new Promise((r) => setTimeout(r, 20))
    expect(empty.container.textContent).toBe("")
  })
})
