import { useCallback, useMemo } from "react"
import { useParams, useSearchParams } from "react-router"

import type { Compare, Filter, FilterOp, Interval, Scope } from "@/lib/api"
import { isFilterDim } from "@/lib/dims"
import {
  DEFAULT_PERIOD,
  intervalsFor,
  isDay,
  isPeriod,
  type Period,
  periodRange,
  timeZone,
} from "@/lib/period"

const OPS: FilterOp[] = ["is", "is_not", "contains"]

/** The API accepts at most this many filters; extra ones in the URL are ignored. */
export const MAX_FILTERS = 10

/** Parses "dim:op:value"; the value may contain colons. */
export function parseFilter(raw: string): Filter | null {
  const a = raw.indexOf(":")
  const b = raw.indexOf(":", a + 1)
  if (a < 0 || b < 0) return null
  const dim = raw.slice(0, a)
  const op = raw.slice(a + 1, b) as FilterOp
  if (!isFilterDim(dim) || !OPS.includes(op)) return null
  return { dim, op, value: raw.slice(b + 1) }
}

export const encodeFilter = (f: Filter) => `${f.dim}:${f.op}:${f.value}`

export type Detail = { dim: Filter["dim"]; value: string }

/**
 * Dashboard state that lives in the URL, shared by every view of a site:
 * period (preset or custom from/to), comparison, chart interval, filters and
 * the open detail sheet.
 */
export function useScope() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()

  const state = useMemo(() => {
    const p = params.get("period")
    const from = params.get("from")
    const to = params.get("to")
    const custom = p === "custom" && isDay(from) && isDay(to) && from <= to
    const period: Period | "custom" = custom
      ? "custom"
      : isPeriod(p)
        ? p
        : DEFAULT_PERIOD
    const range =
      period === "custom"
        ? { from: from!, to: to!, tz: timeZone }
        : periodRange(period)

    const c = params.get("compare")
    const compare: Compare | undefined =
      c === "off" ? undefined : c === "year" ? "year" : "previous"

    const { allowed, auto } = intervalsFor(range)
    const i = params.get("interval") as Interval | null
    const interval: Interval = i && allowed.includes(i) ? i : auto

    const filters = params
      .getAll("f")
      .map(parseFilter)
      .filter((f): f is Filter => f !== null)
      .slice(0, MAX_FILTERS)

    const d = params.get("detail")
    const df = d
      ? parseFilter(
          `${d.slice(0, d.indexOf(":"))}:is:${d.slice(d.indexOf(":") + 1)}`
        )
      : null
    const detail: Detail | null = df ? { dim: df.dim, value: df.value } : null

    const scope: Scope = { ...range, filters, compare }
    return {
      period,
      range,
      compare,
      interval,
      intervals: allowed,
      filters,
      detail,
      scope,
    }
  }, [params])

  const update = useCallback(
    (fn: (p: URLSearchParams) => void) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          fn(next)
          return next
        },
        { preventScrollReset: true }
      ),
    [setParams]
  )

  const actions = useMemo(
    () => ({
      setPeriod: (p: Period) =>
        update((q) => {
          q.set("period", p)
          q.delete("from")
          q.delete("to")
          q.delete("interval")
        }),
      setCustom: (from: string, to: string) =>
        update((q) => {
          q.set("period", "custom")
          q.set("from", from)
          q.set("to", to)
          q.delete("interval")
        }),
      setCompare: (c: Compare | undefined) =>
        update((q) => {
          if (c === "previous") q.delete("compare")
          else q.set("compare", c ?? "off")
        }),
      setInterval: (i: Interval) => update((q) => q.set("interval", i)),
      addFilter: (f: Filter) =>
        update((q) => {
          // One filter per dimension and operator: a new value replaces it.
          const keep = q.getAll("f").filter((raw) => {
            const g = parseFilter(raw)
            return g && !(g.dim === f.dim && g.op === f.op)
          })
          q.delete("f")
          for (const raw of [...keep, encodeFilter(f)]) q.append("f", raw)
        }),
      removeFilter: (f: Filter) =>
        update((q) => {
          const keep = q.getAll("f").filter((raw) => raw !== encodeFilter(f))
          q.delete("f")
          for (const raw of keep) q.append("f", raw)
        }),
      clearFilters: () => update((q) => q.delete("f")),
      openDetail: (d: Detail | null) =>
        update((q) => {
          if (d) q.set("detail", `${d.dim}:${d.value}`)
          else q.delete("detail")
        }),
    }),
    [update]
  )

  /** The query string to carry over when moving between views. */
  const search = useMemo(() => {
    const q = new URLSearchParams(params)
    q.delete("detail")
    const s = q.toString()
    return s ? `?${s}` : ""
  }, [params])

  return { siteId: id, ...state, ...actions, search }
}

export type ScopeState = ReturnType<typeof useScope>
