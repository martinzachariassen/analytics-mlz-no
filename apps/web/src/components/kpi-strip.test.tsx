// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KpiStrip } from "@/components/kpi-strip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { stats } from "@/test/fixtures"

afterEach(cleanup)

const now = Date.parse("2026-11-04T00:00:00Z")

describe("KpiStrip", () => {
  it("shows each metric with its change and picks one for the chart", async () => {
    const onMetric = vi.fn()
    render(
      <TooltipProvider>
        <KpiStrip
          stats={stats()}
          metric="visitors"
          onMetric={onMetric}
          now={now}
        />
      </TooltipProvider>
    )
    const visitors = screen.getByRole("button", { name: "Visitors" })
    expect(visitors.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByText("100")).toBeTruthy()
    // Visitors and page views are both up 25%.
    expect(screen.getAllByText("+25%")).toHaveLength(2)

    await userEvent.click(screen.getByRole("button", { name: "Page views" }))
    expect(onMetric).toHaveBeenCalledWith("pageviews")
  })

  it("explains a metric to keyboard users, separately from picking it", async () => {
    const onMetric = vi.fn()
    render(
      <TooltipProvider>
        <KpiStrip
          stats={stats()}
          metric="visitors"
          onMetric={onMetric}
          now={now}
        />
      </TooltipProvider>
    )
    const help = screen.getByRole("button", { name: "About Bounce rate" })
    help.focus()
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /left after/
    )
    await userEvent.click(help)
    expect(onMetric).not.toHaveBeenCalled()
  })

  it("opens the explanation on a tap", async () => {
    render(
      <TooltipProvider>
        <KpiStrip stats={stats()} now={now} />
      </TooltipProvider>
    )
    await userEvent.click(screen.getByRole("button", { name: "About Visits" }))
    expect((await screen.findByRole("tooltip")).textContent).toMatch(/session/i)
  })

  it("has no metric buttons without onMetric, and placeholders while loading", () => {
    const { container } = render(
      <TooltipProvider>
        <KpiStrip now={now} />
      </TooltipProvider>
    )
    expect(screen.queryByRole("button", { name: "Visitors" })).toBeNull()
    expect(screen.getByText("Visitors")).toBeTruthy()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(12)
  })
})
