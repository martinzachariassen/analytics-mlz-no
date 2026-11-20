// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DataTable } from "@/components/data-table"
import { row } from "@/test/fixtures"

afterEach(cleanup)

const rows = [
  { ...row("/b", 20), bounce_rate: 0.9 },
  { ...row("/a", 30), bounce_rate: 0.1 },
  { ...row("/c", 10), bounce_rate: 0.5 },
]
const names = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[1]!.textContent)

describe("DataTable", () => {
  it("sorts by visitors, and by a column when its header is clicked", async () => {
    render(<DataTable dim="path" rows={rows} total={60} />)
    expect(names()).toEqual(["/a", "/b", "/c"])

    await userEvent.click(screen.getByRole("button", { name: /Bounce/ }))
    const sorted = names()
    expect(sorted[0]).toBe("/b")
    await userEvent.click(screen.getByRole("button", { name: /Bounce/ }))
    expect(names()).toEqual([...sorted].reverse())
    expect(
      screen
        .getByRole("columnheader", { name: /Bounce/ })
        .getAttribute("aria-sort")
    ).toMatch(/ascending|descending/)
  })

  it("searches the rows it has", async () => {
    render(<DataTable dim="path" rows={rows} />)
    await userEvent.type(screen.getByLabelText("Search pages"), "/c")
    expect(names()).toEqual(["/c"])
  })

  it("opens a row and loads more", async () => {
    const onOpen = vi.fn()
    const onLoadMore = vi.fn()
    render(
      <DataTable
        dim="path"
        rows={rows}
        onOpen={onOpen}
        canLoadMore
        onLoadMore={onLoadMore}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "/c" }))
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ value: "/c" })
    )
    await userEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(onLoadMore).toHaveBeenCalled()
  })
})
