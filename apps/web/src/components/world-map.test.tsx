// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorldMap } from "@/components/world-map"
import { row } from "@/test/fixtures"

afterEach(cleanup)

describe("WorldMap", () => {
  it("makes countries with visitors buttons that open them", async () => {
    const onSelect = vi.fn()
    render(
      <WorldMap
        rows={[row("NO", 30), row("SE", 5)]}
        total={35}
        onSelect={onSelect}
      />
    )
    expect(screen.getByRole("group").getAttribute("aria-label")).toMatch(
      /Most: .*Norway 30, .*Sweden 5/
    )
    const norway = screen.getByRole("button", { name: "Norway: 30 visitors" })
    await userEvent.click(norway)
    expect(onSelect).toHaveBeenCalledWith("NO")
    norway.focus()
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledTimes(2)
    // Countries without visitors are not buttons.
    expect(screen.queryByRole("button", { name: /Denmark/ })).toBeNull()
  })

  it("is one image without a click handler", () => {
    render(<WorldMap rows={[]} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Visitors by country: none in this period"
    )
  })
})
