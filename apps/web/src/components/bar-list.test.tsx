// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BarList, ViewAll } from "@/components/bar-list"
import { row } from "@/test/fixtures"

afterEach(cleanup)

describe("BarList", () => {
  it("opens a row, and filters by it with its own button", async () => {
    const onOpen = vi.fn()
    const onFilter = vi.fn()
    render(
      <BarList
        dim="path"
        rows={[row("/a", 30), row("/b", 10)]}
        total={40}
        onOpen={onOpen}
        onFilter={onFilter}
      />
    )
    expect(screen.getByText("75%")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: /^\/a/ }))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ value: "/a" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Filter by /b" }))
    expect(onFilter).toHaveBeenCalledWith(
      expect.objectContaining({ value: "/b" })
    )
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("shows the change instead of the share when comparing", () => {
    render(
      <BarList
        dim="path"
        rows={[{ ...row("/a", 30), previous_visitors: 20 }]}
        total={30}
      />
    )
    expect(screen.getByText("Change")).toBeTruthy()
    expect(screen.getByText("+50%")).toBeTruthy()
  })

  it("has no filter button for dimensions that cannot be filtered", () => {
    render(<BarList dim="prop" rows={[row("pro")]} onFilter={() => {}} />)
    expect(screen.queryByRole("button", { name: /Filter by/ })).toBeNull()
  })

  it("says when the period is empty", () => {
    render(<BarList dim="path" rows={[]} />)
    expect(screen.getByText("Nothing in this period")).toBeTruthy()
  })

  it("links to the full report", () => {
    render(
      <MemoryRouter>
        <ViewAll to="/sites/abc/pages?tab=entry" />
      </MemoryRouter>
    )
    expect(
      screen.getByRole("link", { name: "View all" }).getAttribute("href")
    ).toBe("/sites/abc/pages?tab=entry")
  })
})
