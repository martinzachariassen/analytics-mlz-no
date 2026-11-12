// @vitest-environment happy-dom
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { BreakdownRow } from "@/lib/api"
import { EventsPage, ReportPage } from "@/routes/site/report"
import { mockFetch, renderInSite } from "@/test/render"

afterEach(cleanup)

const report = () => (
  <TooltipProvider>
    <ReportPage report="pages" />
  </TooltipProvider>
)
const events = () => (
  <TooltipProvider>
    <EventsPage />
  </TooltipProvider>
)

const row = (value: string, visitors = 1): BreakdownRow => ({
  value,
  visitors,
  count: visitors,
  visits: visitors,
  bounce_rate: 0,
  avg_duration: 0,
})

describe("ReportPage search", () => {
  it("asks the server when the table holds only the first page of values", async () => {
    // A full first page (100 rows), so the server may have more.
    const page = Array.from({ length: 100 }, (_, i) =>
      row(`/post-${i}`, 200 - i)
    )
    const calls = mockFetch({
      "/api/sites/abc/breakdown": (_: unknown, url: URL) =>
        url.searchParams.getAll("f").includes("path:contains:deep")
          ? [row("/very/deep/page", 1)]
          : page,
    })
    renderInSite(report, "/sites/abc?compare=off")

    await screen.findByRole("button", { name: "/post-0" })
    await userEvent.type(screen.getByLabelText("Search pages"), "deep")

    expect(
      await screen.findByRole("button", { name: "/very/deep/page" })
    ).toBeTruthy()
    expect(
      calls.some(
        (c) =>
          c.includes("/breakdown?") && c.includes("f=path%3Acontains%3Adeep")
      )
    ).toBe(true)
  })

  it("searches only the loaded rows when they are all there is", async () => {
    const calls = mockFetch({
      "/api/sites/abc/breakdown": [row("/a"), row("/deep")],
    })
    renderInSite(report, "/sites/abc?compare=off")

    await screen.findByRole("button", { name: "/a" })
    await userEvent.type(screen.getByLabelText("Search pages"), "deep")

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "/a" })).toBeNull()
    )
    expect(screen.getByRole("button", { name: "/deep" })).toBeTruthy()
    expect(calls.some((c) => c.includes("contains"))).toBe(false)
  })
})

describe("EventsPage", () => {
  const routes = {
    "/api/sites/abc/breakdown": (_: unknown, url: URL) => {
      const dim = url.searchParams.get("dim")
      if (dim === "event") return [row("signup", 10), row("download", 5)]
      if (dim === "prop_key")
        return url.searchParams.get("event") === "download"
          ? [row("file"), row("format")]
          : [row("plan")]
      return [row(`value of ${url.searchParams.get("key")}`)]
    },
  }

  it("keeps the picked event and property in the URL", async () => {
    mockFetch(routes)
    const { search } = renderInSite(events, "/sites/abc?compare=off")

    await screen.findByText("value of plan")
    await userEvent.click(screen.getByRole("button", { name: "download" }))
    expect(search().get("event")).toBe("download")
    expect(await screen.findByText("value of file")).toBeTruthy()
  })

  it("opens the event and property from the URL, and falls back when they are gone", async () => {
    mockFetch(routes)
    renderInSite(events, "/sites/abc?compare=off&event=download&prop=format")
    expect(await screen.findByText("value of format")).toBeTruthy()
    cleanup()

    mockFetch(routes)
    renderInSite(events, "/sites/abc?compare=off&event=gone&prop=gone")
    expect(await screen.findByText("value of plan")).toBeTruthy()
  })
})
