// Time zone arithmetic for the demo engine, matching what the Go server does with
// time.Date(…, loc), AddDate and Format in an IANA location.

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
    })
    formatters.set(tz, f)
  }
  return f
}

/** True if tz is a time zone the browser knows (Go's time.LoadLocation). */
export function validZone(tz: string): boolean {
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export type Wall = {
  y: number
  m: number // 1-12
  d: number
  h: number
  min: number
  s: number
  weekday: number // 0 = Sunday, like Go's time.Weekday
}

const wallCache = new Map<string, Map<number, Wall>>()

/** The wall clock in tz at instant ts (whole seconds). */
export function wall(ts: number, tz: string): Wall {
  const sec = Math.floor(ts / 1000) * 1000
  let byTz = wallCache.get(tz)
  if (!byTz) {
    byTz = new Map()
    wallCache.set(tz, byTz)
  }
  const hit = byTz.get(sec)
  if (hit) return hit
  const out: Wall = { y: 0, m: 0, d: 0, h: 0, min: 0, s: 0, weekday: 0 }
  for (const p of formatter(tz).formatToParts(new Date(sec))) {
    switch (p.type) {
      case "year":
        out.y = Number(p.value)
        break
      case "month":
        out.m = Number(p.value)
        break
      case "day":
        out.d = Number(p.value)
        break
      case "hour":
        out.h = Number(p.value)
        break
      case "minute":
        out.min = Number(p.value)
        break
      case "second":
        out.s = Number(p.value)
        break
      case "weekday":
        out.weekday = WEEKDAYS[p.value] ?? 0
        break
    }
  }
  if (byTz.size > 20_000) byTz.clear()
  byTz.set(sec, out)
  return out
}

/** Offset of tz from UTC at instant ts, in milliseconds. */
export function offset(ts: number, tz: string): number {
  const w = wall(ts, tz)
  return (
    Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ts / 1000) * 1000
  )
}

/**
 * time.Date(y, m, d, h, 0, 0, 0, loc): out-of-range months and days roll over, like Go.
 * A wall time that does not exist (a DST gap) moves forward by the gap, as Go does.
 */
export function date(
  y: number,
  m: number,
  d: number,
  tz: string,
  h = 0
): number {
  const guess = Date.UTC(y, m - 1, d, h)
  const first = guess - offset(guess, tz)
  const second = guess - offset(first, tz)
  if (offset(second, tz) === offset(first, tz)) return first
  return Math.max(first, second)
}

/** t.AddDate(years, months, days) for a local midnight t. */
export function addDate(
  t: number,
  tz: string,
  years: number,
  months: number,
  days: number
): number {
  const w = wall(t, tz)
  return date(w.y + years, w.m + months, w.d + days, tz, w.h)
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0")

/** Format(time.DateOnly) in tz. */
export function dateOnly(ts: number, tz: string): string {
  const w = wall(ts, tz)
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`
}

/** Go's time.RFC3339 (and JSON) rendering of ts in tz: "Z" for a zero offset. */
export function rfc3339(ts: number, tz: string): string {
  const w = wall(ts, tz)
  const off = offset(ts, tz) / 60_000
  const zone =
    off === 0
      ? "Z"
      : `${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.min)}:${pad(w.s)}${zone}`
}

/** Parses YYYY-MM-DD strictly, as time.ParseInLocation(time.DateOnly, …) does. */
export function parseDate(
  s: string
): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return null
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  if (d > days) return null
  return { y, m: mo, d }
}
