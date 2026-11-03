const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const full = new Intl.NumberFormat("en")

/** 1234 -> "1.2K"; small numbers are shown in full. */
export function formatNumber(n: number): string {
  return n < 10_000 ? full.format(n) : compact.format(n)
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Seconds -> "1m 05s" / "42s". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

/** Relative change from previous to current, or null when there is no baseline. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

const regions = new Intl.DisplayNames(["en"], { type: "region" })

/** "NO" -> "🇳🇴 Norway". */
export function formatCountry(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "Unknown"
  const flag = String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  )
  let name = code
  try {
    name = regions.of(code) ?? code
  } catch {
    // unknown region code
  }
  return `${flag} ${name}`
}
