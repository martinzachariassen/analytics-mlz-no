// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import type { Dimension, Scope, Site } from "@/lib/api"
import {
  IDLE_POLL_MS,
  useBreakdown,
  WAITING_POLL_MS,
  waitingPoll,
} from "@/lib/queries"

const site: Site = {
  id: "abc",
  name: "Blog",
  domain: "blog.example",
  created_at: "2026-11-12T10:00:00Z",
  pixel_enabled: false,
  first_event_at: null,
  last_event_at: null,
}
const at = (iso: string) => Date.parse(iso)

describe("waitingPoll", () => {
  it("polls fast in the first hour after a site was added", () => {
    expect(waitingPoll(site, at("2026-11-12T10:00:30Z"))).toBe(WAITING_POLL_MS)
    expect(waitingPoll(site, at("2026-11-12T10:59:59Z"))).toBe(WAITING_POLL_MS)
  })

  it("backs off to once a minute after that", () => {
    expect(waitingPoll(site, at("2026-11-12T11:00:00Z"))).toBe(IDLE_POLL_MS)
    expect(waitingPoll(site, at("2026-12-01T00:00:00Z"))).toBe(IDLE_POLL_MS)
  })

  it("stops once the site has data", () => {
    const live = {
      ...site,
      first_event_at: "2026-11-12T10:05:00Z",
      last_event_at: "2026-11-12T10:05:00Z",
    }
    expect(waitingPoll(live, at("2026-11-12T10:06:00Z"))).toBe(false)
  })
})

describe("useBreakdown placeholder", () => {
  // Answers each request with its dim and from date, once the test lets it through.
  function slowApi() {
    const pending: Array<() => void> = []
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const q = new URL(String(input), "http://localhost").searchParams
      const rows = [
        { value: `${q.get("dim")} ${q.get("from")}`, visitors: 1, count: 1 },
      ]
      return new Promise<Response>((resolve) =>
        pending.push(() => resolve(Response.json(rows)))
      )
    }) as typeof fetch
    return () =>
      act(() => {
        for (const go of pending.splice(0)) go()
      })
  }

  function setup() {
    const release = slowApi()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const view = renderHook(
      ({ scope, dim }: { scope: Scope; dim: Dimension }) =>
        useBreakdown("abc", scope, dim),
      { wrapper, initialProps: { scope: november, dim: "path" as Dimension } }
    )
    return { ...view, release }
  }
  const november: Scope = { from: "2026-11-01", to: "2026-11-30", tz: "UTC" }
  const october: Scope = { from: "2026-10-01", to: "2026-10-31", tz: "UTC" }

  it("keeps the old rows while a new period loads", async () => {
    const { result, rerender, release } = setup()
    await release()
    await waitFor(() =>
      expect(result.current.data?.[0]?.value).toBe("path 2026-11-01")
    )
    rerender({ scope: october, dim: "path" })
    expect(result.current.data?.[0]?.value).toBe("path 2026-11-01")
    expect(result.current.isPlaceholderData).toBe(true)
    await release()
    await waitFor(() =>
      expect(result.current.data?.[0]?.value).toBe("path 2026-10-01")
    )
  })

  it("shows nothing from the old tab while a new dimension loads", async () => {
    const { result, rerender, release } = setup()
    await release()
    await waitFor(() => expect(result.current.data).toBeDefined())
    rerender({ scope: november, dim: "referrer" })
    expect(result.current.data).toBeUndefined()
    await release()
    await waitFor(() =>
      expect(result.current.data?.[0]?.value).toBe("referrer 2026-11-01")
    )
  })
})
