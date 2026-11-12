import { describe, expect, it } from "vitest"

import {
  change,
  formatCountry,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRate,
} from "@/lib/format"

describe("formatNumber", () => {
  it("shows small numbers in full and compacts large ones", () => {
    expect(formatNumber(999)).toBe("999")
    expect(formatNumber(9_999)).toBe("9,999")
    expect(formatNumber(12_300)).toBe("12.3K")
  })
})

describe("formatPercent", () => {
  it("rounds a ratio to a whole percent", () => {
    expect(formatPercent(0.456)).toBe("46%")
  })
})

describe("formatRate", () => {
  it("keeps a decimal for small rates only", () => {
    expect(formatRate(0)).toBe("0%")
    expect(formatRate(0.0042)).toBe("0.4%")
    expect(formatRate(0.0951)).toBe("9.5%")
    expect(formatRate(0.0003)).toBe("<0.1%")
    expect(formatRate(0.0996)).toBe("10%")
    expect(formatRate(0.456)).toBe("46%")
    expect(formatRate(1)).toBe("100%")
  })
})

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(42)).toBe("42s")
    expect(formatDuration(65)).toBe("1m 05s")
    expect(formatDuration(3_725)).toBe("1h 02m")
  })
})

describe("change", () => {
  it("returns the relative change", () => {
    expect(change(150, 100)).toBe(0.5)
  })
  it("has no baseline when the previous value is zero", () => {
    expect(change(5, 0)).toBeNull()
    expect(change(0, 0)).toBe(0)
  })
})

describe("formatCountry", () => {
  it("falls back to Unknown for invalid codes", () => {
    expect(formatCountry("")).toBe("Unknown")
    expect(formatCountry("xx1")).toBe("Unknown")
  })
  it("includes the country name", () => {
    expect(formatCountry("NO")).toContain("Norway")
  })
})
