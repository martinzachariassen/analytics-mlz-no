import { describe, expect, it } from "vitest"

import {
  intervalsFor,
  isDay,
  isPeriod,
  periodRange,
  rangeDays,
} from "@/lib/period"

// Local noon avoids DST edge cases around midnight.
const now = new Date(2026, 10, 4, 12)

describe("isPeriod", () => {
  it("accepts presets and rejects inherited property names", () => {
    expect(isPeriod("7d")).toBe(true)
    expect(isPeriod("custom")).toBe(false)
    expect(isPeriod(null)).toBe(false)
    for (const v of ["toString", "constructor", "__proto__"])
      expect(isPeriod(v)).toBe(false)
  })
})

describe("periodRange", () => {
  it("covers the last 7 days inclusive of today", () => {
    const r = periodRange("7d", now)
    expect(r.from).toBe("2026-10-29")
    expect(r.to).toBe("2026-11-04")
    expect(rangeDays(r)).toBe(7)
  })
  it("handles last month", () => {
    const r = periodRange("last_month", now)
    expect(r.from).toBe("2026-10-01")
    expect(r.to).toBe("2026-10-31")
  })
})

describe("intervalsFor", () => {
  it("picks hourly for a single day and monthly for long ranges", () => {
    expect(intervalsFor({ from: "2026-11-04", to: "2026-11-04" }).auto).toBe(
      "hour"
    )
    expect(intervalsFor({ from: "2025-01-01", to: "2026-01-01" }).auto).toBe(
      "month"
    )
  })
})

describe("validators", () => {
  it("recognises periods and days", () => {
    expect(isPeriod("7d")).toBe(true)
    expect(isPeriod("nope")).toBe(false)
    expect(isPeriod(null)).toBe(false)
    expect(isDay("2026-11-04")).toBe(true)
    expect(isDay("04.11.2026")).toBe(false)
  })
})
