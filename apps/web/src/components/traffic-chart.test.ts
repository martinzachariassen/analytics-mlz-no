import { describe, expect, it } from "vitest"

import type { Bucket, PeriodInfo } from "@/lib/api"
import { bucketEnds } from "./traffic-chart"

const bucket = (t: string): Bucket => ({
  t,
  pageviews: 0,
  visitors: 0,
  visits: 0,
  bounce_rate: 0,
  avg_duration: 0,
})
const period = (
  from: string,
  to: string,
  interval: PeriodInfo["interval"]
): PeriodInfo => ({
  from,
  to,
  tz: "Europe/Oslo",
  interval,
})

describe("bucketEnds", () => {
  it("ends each month where the next one starts, and the last at the period's end", () => {
    const ends = bucketEnds({
      period: period("2026-10-01", "2026-11-30", "month"),
      timeseries: [
        bucket("2026-10-01T00:00:00+02:00"),
        bucket("2026-11-01T00:00:00+01:00"),
      ],
    })
    expect(ends).toEqual([
      Date.parse("2026-11-01T00:00:00+01:00"),
      Date.parse("2026-12-01T00:00:00+01:00"),
    ])
  })

  it("does not reach into the next month for a 30-day month", () => {
    // Viewed on 1 October, September is finished: 31 days from its start would say it is not.
    const [end] = bucketEnds({
      period: period("2026-09-01", "2026-09-30", "month"),
      timeseries: [bucket("2026-09-01T00:00:00+02:00")],
    })
    expect(end).toBe(Date.parse("2026-10-01T00:00:00+02:00"))
    expect(Date.parse("2026-10-01T10:00:00+02:00") < end!).toBe(false)
  })

  it("follows a 23-hour DST day and UTC periods", () => {
    const ends = bucketEnds({
      period: period("2026-03-29", "2026-03-30", "day"),
      timeseries: [
        bucket("2026-03-29T00:00:00+01:00"),
        bucket("2026-03-30T00:00:00+02:00"),
      ],
    })
    expect(ends[0]! - Date.parse("2026-03-29T00:00:00+01:00")).toBe(
      23 * 3_600_000
    )
    expect(ends[1]).toBe(Date.parse("2026-03-31T00:00:00+02:00"))

    const utc = bucketEnds({
      period: { ...period("2026-11-18", "2026-11-18", "hour"), tz: "UTC" },
      timeseries: [
        bucket("2026-11-18T22:00:00Z"),
        bucket("2026-11-18T23:00:00Z"),
      ],
    })
    expect(utc).toEqual([
      Date.parse("2026-11-18T23:00:00Z"),
      Date.parse("2026-11-19T00:00:00Z"),
    ])
  })
})
