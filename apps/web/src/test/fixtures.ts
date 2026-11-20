import type { BreakdownRow, Bucket, Site, Stats, Summary } from "@/lib/api"

export const summary = (s: Partial<Summary> = {}): Summary => ({
  pageviews: 0,
  visitors: 0,
  visits: 0,
  bounce_rate: 0,
  avg_duration: 0,
  ...s,
})

export const bucket = (t: string, s: Partial<Summary> = {}): Bucket => ({
  t,
  ...summary(s),
})

/** Three days of stats with a comparison: 100 visitors against 80. */
export function stats(over: Partial<Stats> = {}): Stats {
  return {
    period: {
      from: "2026-11-01",
      to: "2026-11-03",
      tz: "UTC",
      interval: "day",
    },
    compare: {
      from: "2026-10-29",
      to: "2026-10-31",
      tz: "UTC",
      interval: "day",
    },
    summary: summary({ visitors: 100, visits: 120, pageviews: 300 }),
    previous: summary({ visitors: 80, visits: 100, pageviews: 240 }),
    timeseries: [
      bucket("2026-11-01T00:00:00Z", { visitors: 20, pageviews: 60 }),
      bucket("2026-11-02T00:00:00Z", { visitors: 50, pageviews: 150 }),
      bucket("2026-11-03T00:00:00Z", { visitors: 30, pageviews: 90 }),
    ],
    ...over,
  }
}

export const row = (value: string, visitors = 1): BreakdownRow => ({
  value,
  visitors,
  count: visitors,
  visits: visitors,
  bounce_rate: 0,
  avg_duration: 0,
})

export const site = (over: Partial<Site> = {}): Site => ({
  id: "abc",
  name: "Blog",
  domain: "blog.example",
  created_at: "2026-11-12T10:00:00Z",
  pixel_enabled: false,
  first_event_at: "2026-11-12T10:05:00Z",
  last_event_at: "2026-11-12T10:05:00Z",
  ...over,
})

export const githubUser = { login: "martin", provider: "github" }
