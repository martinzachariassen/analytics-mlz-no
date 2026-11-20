// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { ReportCard } from "@/components/report-card"
import { row } from "@/test/fixtures"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const card = () => (
  <ReportCard
    id="pages"
    title="Pages"
    tabs={[
      { dim: "path", label: "Top pages" },
      { dim: "entry", label: "Entry" },
    ]}
  />
)

const routes = {
  "/api/sites/abc/breakdown": (_: unknown, url: URL) => [
    row(`/${url.searchParams.get("dim")}-page`, 5),
  ],
}

describe("ReportCard", () => {
  it("keeps its tab in the URL and links to the report on the same tab", async () => {
    mockFetch(routes)
    const { search } = renderInSite(card, "/sites/abc?period=30d")
    await screen.findByRole("button", { name: /^\/path-page/ })

    await userEvent.click(screen.getByRole("tab", { name: "Entry" }))
    await waitFor(() => expect(search().get("pages_tab")).toBe("entry"))
    expect(
      await screen.findByRole("button", { name: /^\/entry-page/ })
    ).toBeTruthy()
    const href = screen
      .getByRole("link", { name: "View all" })
      .getAttribute("href")!
    expect(href.startsWith("/sites/abc/pages?")).toBe(true)
    const q = new URLSearchParams(href.split("?")[1])
    expect(q.get("tab")).toBe("entry")
    expect(q.get("period")).toBe("30d")
  })

  it("opens the tab from the URL and ignores one it does not have", async () => {
    mockFetch(routes)
    renderInSite(card, "/sites/abc?pages_tab=entry")
    expect(
      await screen.findByRole("button", { name: /^\/entry-page/ })
    ).toBeTruthy()
    cleanup()

    mockFetch(routes)
    renderInSite(card, "/sites/abc?pages_tab=nope")
    expect(
      await screen.findByRole("button", { name: /^\/path-page/ })
    ).toBeTruthy()
  })

  it("opens the detail sheet and adds a filter from a row", async () => {
    mockFetch(routes)
    const { search } = renderInSite(card)
    await userEvent.click(
      await screen.findByRole("button", { name: /^\/path-page/ })
    )
    await waitFor(() => expect(search().get("detail")).toBe("path:/path-page"))
    await userEvent.click(
      screen.getByRole("button", { name: "Filter by /path-page" })
    )
    await waitFor(() =>
      expect(search().getAll("f")).toEqual(["path:is:/path-page"])
    )
  })
})
