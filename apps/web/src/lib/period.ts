import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  isSameYear,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns"

import type { Interval, RangeParams } from "@/lib/api"

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
  return v !== null && Object.hasOwn(PERIODS, v)
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

/**
 * The period to compare r with: the same-length period right before it, or for
 * "Last 12 months" the 12 calendar months before, so month buckets line up.
 */
export function previousRange(r: RangeParams, p?: Period): RangeParams {
  const from = parseISO(r.from)
  if (p === "12m") {
    return {
      from: day(subMonths(from, 12)),
      to: day(subDays(from, 1)),
      tz: r.tz,
    }
  }
  const days = differenceInCalendarDays(parseISO(r.to), from) + 1
  return {
    from: day(subDays(from, days)),
    to: day(subDays(from, 1)),
    tz: r.tz,
  }
}

/** "28 Oct – 3 Nov 2026", or "Tue 3 Nov 2026" for a single day. */
export function formatRange(r: Pick<RangeParams, "from" | "to">): string {
  const from = parseISO(r.from)
  const to = parseISO(r.to)
  if (r.from === r.to) return format(from, "EEE d MMM yyyy")
  if (!isSameYear(from, to))
    return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`
  if (from.getMonth() === to.getMonth())
    return `${format(from, "d")}–${format(to, "d MMM yyyy")}`
  return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`
}

/** True when the range ends today, so its last bucket is still filling up. */
export function endsToday(r: RangeParams, now = new Date()): boolean {
  return r.to === day(now)
}

/** Number of days in a range, inclusive. */
export function rangeDays(r: Pick<RangeParams, "from" | "to">): number {
  return differenceInCalendarDays(parseISO(r.to), parseISO(r.from)) + 1
}

/** Intervals the API allows for a range, and the one it picks by default. */
export function intervalsFor(r: Pick<RangeParams, "from" | "to">): {
  allowed: Interval[]
  auto: Interval
} {
  const days = rangeDays(r)
  const allowed: Interval[] = []
  if (days <= 7) allowed.push("hour")
  if (days <= 400) allowed.push("day")
  if (days >= 14) allowed.push("week")
  if (days >= 60) allowed.push("month")
  const auto: Interval = days <= 2 ? "hour" : days <= 93 ? "day" : "month"
  return { allowed, auto }
}

export const INTERVALS: Record<Interval, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
}

export function isDay(v: string | null): v is string {
  return (
    v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(parseISO(v).getTime())
  )
}

export { day as formatDay }
