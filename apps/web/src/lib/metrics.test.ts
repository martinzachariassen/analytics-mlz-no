import { describe, expect, it } from "vitest"

import { isMetric, METRIC, METRICS } from "@/lib/metrics"

describe("isMetric", () => {
  it("accepts every metric key and nothing else", () => {
    for (const m of METRICS) expect(isMetric(m.key)).toBe(true)
    expect(isMetric(null)).toBe(false)
    expect(isMetric("")).toBe(false)
    expect(isMetric("clicks")).toBe(false)
  })
  it("ignores inherited object properties from the URL", () => {
    for (const v of ["toString", "constructor", "__proto__", "hasOwnProperty"])
      expect(isMetric(v)).toBe(false)
  })
})

describe("METRIC", () => {
  const s = {
    pageviews: 30,
    visitors: 10,
    visits: 12,
    bounce_rate: 0.5,
    avg_duration: 90,
  }
  it("derives views per visit and guards against zero visits", () => {
    expect(METRIC.views_per_visit.value(s)).toBe(2.5)
    expect(METRIC.views_per_visit.value({ ...s, visits: 0 })).toBe(0)
    expect(METRIC.views_per_visit.format(2.5)).toBe("2.5")
  })
  it("marks rates and averages so they are not summed", () => {
    expect(METRICS.filter((m) => m.average).map((m) => m.key)).toEqual([
      "views_per_visit",
      "bounce_rate",
      "avg_duration",
    ])
    expect(METRIC.bounce_rate.lowerIsBetter).toBe(true)
  })
})
