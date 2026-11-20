// @vitest-environment happy-dom
import { act, cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  encodeFilter,
  MAX_FILTERS,
  parseFilter,
  type ScopeState,
} from "@/lib/use-scope"
import { renderInSite } from "@/test/render"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Renders useScope at url and returns a getter for the latest value. */
function scopeAt(url: string) {
  let latest: ScopeState
  const view = renderInSite((sc) => {
    latest = sc
    return <span />
  }, url)
  return { ...view, sc: () => latest }
}

describe("parseFilter", () => {
  it("parses dim:op:value and keeps colons in the value", () => {
    expect(parseFilter("path:is:/a:b")).toEqual({
      dim: "path",
      op: "is",
      value: "/a:b",
    })
  })
  it("rejects unknown operators, dimensions and malformed input", () => {
    expect(parseFilter("path:like:/a")).toBeNull()
    expect(parseFilter("nope:is:/a")).toBeNull()
    expect(parseFilter("path")).toBeNull()
  })
  it("caps the number of filters at what the API accepts", () => {
    expect(MAX_FILTERS).toBe(10)
  })
  it("round-trips with encodeFilter", () => {
    const f = { dim: "path", op: "contains", value: "blog" } as const
    expect(parseFilter(encodeFilter(f))).toEqual(f)
  })
})

describe("useScope", () => {
  it("reads period, comparison, interval, filters and the detail from the URL", () => {
    const { sc } = scopeAt(
      "/sites/abc?period=custom&from=2026-11-01&to=2026-11-03&compare=year&interval=hour&f=path:is:/a:b&f=bad&detail=referrer:news.example:8080"
    )
    expect(sc().period).toBe("custom")
    expect(sc().range).toMatchObject({ from: "2026-11-01", to: "2026-11-03" })
    expect(sc().compare).toBe("year")
    expect(sc().interval).toBe("hour")
    expect(sc().filters).toEqual([{ dim: "path", op: "is", value: "/a:b" }])
    expect(sc().detail).toEqual({ dim: "referrer", value: "news.example:8080" })
  })

  it("falls back for values it cannot use", () => {
    // A reversed range, an interval the range does not allow, an unknown dimension in detail.
    const { sc } = scopeAt(
      "/sites/abc?period=custom&from=2026-11-05&to=2026-11-01&compare=off&interval=month&detail=nope:x"
    )
    expect(sc().period).toBe("7d")
    expect(sc().interval).toBe("day")
    expect(sc().compare).toBeUndefined()
    expect(sc().detail).toBeNull()
    expect(scopeAt("/sites/abc?detail=path").sc().detail).toBeNull()
  })

  it("keeps one filter per dimension and operator, and removes filters", () => {
    const { sc, search } = scopeAt("/sites/abc?f=path:is:/a&f=path:is_not:/b")
    act(() => sc().addFilter({ dim: "path", op: "is", value: "/c" }))
    expect(search().getAll("f")).toEqual(["path:is_not:/b", "path:is:/c"])
    act(() => sc().removeFilter({ dim: "path", op: "is_not", value: "/b" }))
    expect(search().getAll("f")).toEqual(["path:is:/c"])
    act(() => sc().clearFilters())
    expect(search().getAll("f")).toEqual([])
  })

  it("keeps both of two updates made before a render", () => {
    const { sc, search } = scopeAt("/sites/abc?detail=path:/a")
    act(() => {
      const s = sc()
      s.addFilter({ dim: "path", op: "is", value: "/a" })
      s.openDetail(null)
      s.updateParams((q) => q.set("tab", "entry"))
    })
    expect(search().getAll("f")).toEqual(["path:is:/a"])
    expect(search().get("detail")).toBeNull()
    expect(search().get("tab")).toBe("entry")
  })

  it("resets the interval and custom dates when a preset is picked", () => {
    const { sc, search } = scopeAt(
      "/sites/abc?period=custom&from=2026-11-01&to=2026-11-02&interval=hour"
    )
    act(() => sc().setPeriod("30d"))
    expect(search().toString()).toBe("period=30d")
  })

  it("moves a preset on at midnight in a tab left open", () => {
    vi.useFakeTimers({
      now: new Date(2026, 10, 18, 23, 59, 0),
      shouldAdvanceTime: false,
    })
    const { sc } = scopeAt("/sites/abc?period=today")
    expect(sc().range).toMatchObject({ from: "2026-11-18", to: "2026-11-18" })
    act(() => vi.advanceTimersByTime(2 * 60_000))
    expect(sc().range).toMatchObject({ from: "2026-11-19", to: "2026-11-19" })
  })
})
