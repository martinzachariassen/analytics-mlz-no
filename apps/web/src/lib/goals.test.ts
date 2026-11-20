import { describe, expect, it } from "vitest"

import { goalFilter, goalKindFor, goalLabel } from "@/lib/goals"

describe("goals", () => {
  it("filters an event goal on the event and an exact page goal on the path", () => {
    expect(goalFilter({ kind: "event", value: "signup" })).toEqual({
      dim: "event",
      op: "is",
      value: "signup",
    })
    expect(goalFilter({ kind: "path", value: "/thanks" })).toEqual({
      dim: "path",
      op: "is",
      value: "/thanks",
    })
  })

  it("has no filter for a wildcard page goal", () => {
    expect(goalFilter({ kind: "path", value: "/blog/*" })).toBeNull()
  })

  it("turns pages and events into goals, and nothing else", () => {
    expect(goalKindFor("event")).toBe("event")
    for (const d of ["path", "entry", "exit"] as const)
      expect(goalKindFor(d)).toBe("path")
    for (const d of ["referrer", "country", "prop"] as const)
      expect(goalKindFor(d)).toBeNull()
  })

  it("labels a page goal as typed", () => {
    expect(goalLabel({ kind: "path", value: "/blog/*" })).toBe("/blog/*")
  })
})
