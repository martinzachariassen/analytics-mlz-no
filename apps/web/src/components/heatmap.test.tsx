// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { ActiveHours, busiest, ramp } from "@/components/heatmap"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const grid = (hot: [number, number], v: number) =>
  Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => (d === hot[0] && h === hot[1] ? v : 1))
  )

const heatmap = () => (
  <TooltipProvider>
    <ActiveHours />
  </TooltipProvider>
)

describe("ActiveHours", () => {
  it("summarises the busiest hour and switches metric in the URL", async () => {
    mockFetch({
      "/api/sites/abc/heatmap": {
        visitors: grid([1, 14], 40),
        pageviews: grid([4, 9], 90),
      },
    })
    const { search } = renderInSite(heatmap)
    expect(
      await screen.findByText("Busiest hour: Tue 14:00–15:00 with 40 visitors.")
    ).toBeTruthy()

    await userEvent.click(screen.getByRole("tab", { name: "Page views" }))
    await waitFor(() => expect(search().get("hours")).toBe("pageviews"))
    expect(
      await screen.findByText(
        "Busiest hour: Fri 09:00–10:00 with 90 page views."
      )
    ).toBeTruthy()
  })

  it("has one tab stop and moves between cells with the arrow keys", async () => {
    mockFetch({
      "/api/sites/abc/heatmap": {
        visitors: grid([0, 0], 5),
        pageviews: grid([0, 0], 5),
      },
    })
    renderInSite(heatmap)
    const first = await screen.findByRole("button", {
      name: /^Mon 00:00–01:00/,
    })
    const cells = screen.getAllByRole("button", { name: /visitors$/ })
    expect(cells.filter((c) => c.tabIndex === 0)).toEqual([first])

    first.focus()
    await userEvent.keyboard("{ArrowRight}{ArrowDown}")
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Tue 01:00–02:00 · 1 visitors"
    )
    await userEvent.keyboard("{End}")
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Tue 23:00/
    )
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /Tue 23:00/
    )
  })

  it("starts the colour ramp from the empty colour", () => {
    expect(ramp(0)).toBe("var(--surface-2)")
    expect(ramp(1)).toContain("100%")
    expect(
      busiest([
        [0, 3],
        [7, 1],
      ])
    ).toEqual({ d: 1, h: 0, v: 7 })
  })
})
