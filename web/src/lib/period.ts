import { format, startOfMonth, subDays, subMonths, endOfMonth } from "date-fns"

import type { RangeParams } from "@/lib/api"

export const PERIODS = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  last_month: "Last month",
  "12m": "Last 12 months",
} as const

export type Period = keyof typeof PERIODS

export const DEFAULT_PERIOD: Period = "7d"

export function isPeriod(v: string | null): v is Period {
  return v !== null && v in PERIODS
}

/** The browser's IANA time zone, so days match what the user sees on their clock. */
export const timeZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

const day = (d: Date) => format(d, "yyyy-MM-dd")

/** Converts a preset into the API's inclusive from/to dates in the browser's time zone. */
export function periodRange(p: Period, now = new Date()): RangeParams {
  switch (p) {
    case "today":
      return { from: day(now), to: day(now), tz: timeZone }
    case "yesterday": {
      const y = subDays(now, 1)
      return { from: day(y), to: day(y), tz: timeZone }
    }
    case "7d":
      return { from: day(subDays(now, 6)), to: day(now), tz: timeZone }
    case "30d":
      return { from: day(subDays(now, 29)), to: day(now), tz: timeZone }
    case "month":
      return { from: day(startOfMonth(now)), to: day(now), tz: timeZone }
    case "last_month": {
      const m = subMonths(now, 1)
      return {
        from: day(startOfMonth(m)),
        to: day(endOfMonth(m)),
        tz: timeZone,
      }
    }
    case "12m":
      return {
        from: day(startOfMonth(subMonths(now, 11))),
        to: day(now),
        tz: timeZone,
      }
  }
}
