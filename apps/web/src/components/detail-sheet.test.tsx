// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { DetailSheet } from "@/components/detail-sheet"
import type { Stats } from "@/lib/api"
import { mockFetch, renderInSite } from "@/test/render"

const summary = {
  pageviews: 120,
  visitors: 42,
  visits: 50,
  bounce_rate: 0.4,
  avg_duration: 65,
}
const stats: Stats = {
  period: { from: "2026-11-05", to: "2026-11-11", tz: "UTC", interval: "day" },
  summary,
  previous: { ...summary, visitors: 21 },
  timeseries: [],
}

afterEach(cleanup)
let calls: string[]
beforeEach(() => {
  calls = mockFetch({
    "/api/sites/abc/stats": stats,
    "/api/sites/abc/breakdown": [{ value: "NO", visitors: 30, pageviews: 80 }],
  })
})

describe("DetailSheet", () => {
  it("stays closed without ?detail", () => {
    renderInSite(() => <DetailSheet />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("shows the value's numbers, scoped to it", async () => {
    renderInSite(() => <DetailSheet />, "/sites/abc?detail=path:/blog")

    const dialog = await screen.findByRole("dialog")
    expect(dialog.textContent).toContain("/blog")
    expect(await screen.findByText("42")).toBeTruthy()
    expect(
      calls.some(
        (c) => c.includes("stats") && c.includes("f=path%3Ais%3A%2Fblog")
      )
    ).toBe(true)
  })

  it("turns the value into a dashboard filter and closes", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      () => <DetailSheet />,
      "/sites/abc?detail=path:/blog"
    )
    await user.click(
      await screen.findByRole("button", { name: /Filter dashboard by this/ })
    )
    await waitFor(() => expect(search().get("detail")).toBeNull())
    expect(search().getAll("f")).toEqual(["path:is:/blog"])
  })
})
