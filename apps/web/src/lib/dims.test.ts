import { describe, expect, it } from "vitest"

import { DIMS, formatValue, isFilterDim } from "@/lib/dims"

describe("isFilterDim", () => {
  it("accepts filterable dimensions only", () => {
    expect(isFilterDim("path")).toBe(true)
    expect(isFilterDim("country")).toBe(true)
    expect(isFilterDim("prop")).toBe(false)
    expect(isFilterDim("prop_key")).toBe(false)
    expect(isFilterDim("toString")).toBe(false)
    expect(isFilterDim("")).toBe(false)
  })
})

describe("formatValue", () => {
  it("uses the dimension's wording for empty values", () => {
    expect(formatValue("referrer", "")).toBe(DIMS.referrer.empty)
    expect(formatValue("utm_source", "")).toBe(DIMS.utm_source.empty)
  })
  it("expands country codes and leaves other values alone", () => {
    expect(formatValue("country", "NO")).toContain("Norway")
    expect(formatValue("path", "/blog")).toBe("/blog")
  })
})
