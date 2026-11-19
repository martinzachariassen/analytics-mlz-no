// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FilterBar } from "@/components/filter-bar"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)
beforeEach(() => {
  mockFetch({
    "/api/sites/abc/breakdown": [
      { value: "/blog", visitors: 12, pageviews: 30 },
      { value: "/about", visitors: 4, pageviews: 5 },
    ],
  })
})

describe("FilterBar", () => {
  it("shows filters from the URL and removes one", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      (sc) => <FilterBar sc={sc} />,
      "/sites/abc?f=path:is:/blog&f=country:is_not:NO"
    )
    expect(await screen.findAllByLabelText("Remove filter")).toHaveLength(2)

    await user.click(screen.getAllByLabelText("Remove filter")[0]!)
    await waitFor(() =>
      expect(search().getAll("f")).toEqual(["country:is_not:NO"])
    )
  })

  it("clears every filter", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite(
      (sc) => <FilterBar sc={sc} />,
      "/sites/abc?f=path:is:/blog&f=country:is:NO"
    )
    await user.click(await screen.findByRole("button", { name: "Clear" }))
    await waitFor(() => expect(search().getAll("f")).toEqual([]))
  })

  it("adds a filter from a suggested value", async () => {
    const user = userEvent.setup()
    const { search } = renderInSite((sc) => <FilterBar sc={sc} />)

    await user.click(await screen.findByRole("button", { name: /Filter/ }))
    await user.click(await screen.findByRole("option", { name: "Page" }))
    await user.click(await screen.findByRole("option", { name: /\/blog/ }))

    await waitFor(() => expect(search().getAll("f")).toEqual(["path:is:/blog"]))
  })

  it("adds a contains filter from typed text, as one history entry", async () => {
    const user = userEvent.setup()
    const { search, router } = renderInSite((sc) => <FilterBar sc={sc} />)

    await user.click(await screen.findByRole("button", { name: /Filter/ }))
    await user.click(await screen.findByRole("option", { name: "Page" }))
    await user.click(screen.getByRole("button", { name: "contains" }))
    await user.type(
      screen.getByPlaceholderText("Text to match…"),
      "docs{Enter}"
    )

    await waitFor(() =>
      expect(search().getAll("f")).toEqual(["path:contains:docs"])
    )
    // Back once undoes it: Enter in the input and the selected option did not both add it.
    await act(() => router.navigate(-1))
    expect(search().getAll("f")).toEqual([])
  })

  it("says when the suggested values could not be loaded", async () => {
    mockFetch({
      "/api/sites/abc/breakdown": () =>
        new Response(JSON.stringify({ error: "bad" }), { status: 400 }),
    })
    const user = userEvent.setup()
    renderInSite((sc) => <FilterBar sc={sc} />)
    await user.click(await screen.findByRole("button", { name: /Filter/ }))
    await user.click(await screen.findByRole("option", { name: "Page" }))
    expect(await screen.findByText(/Could not load the values/)).toBeTruthy()
    expect(screen.queryByText("No values in this period")).toBeNull()
  })
})
