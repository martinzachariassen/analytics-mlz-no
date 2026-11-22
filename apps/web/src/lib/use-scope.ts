import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { useLocation, useParams, useSearchParams } from "react-router"

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

// Presets such as "Today" are dates, so they must move on at midnight in a tab left open. One
// timer for the whole app; it is also checked when the tab becomes visible, since timers in a
// sleeping laptop or a background tab can fire late.
const dayKey = () => new Date().toDateString()
function subscribeToday(changed: () => void) {
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => {
    const now = new Date()
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1
    )
    timer = setTimeout(
      () => {
        changed()
        schedule()
      },
      midnight.getTime() - now.getTime() + 1000
    )
  }
  schedule()
  document.addEventListener("visibilitychange", changed)
  return () => {
    clearTimeout(timer)
    document.removeEventListener("visibilitychange", changed)
  }
}
/** The local date, which re-renders its users when it changes. */
export const useToday = () => useSyncExternalStore(subscribeToday, dayKey)

// React Router hands every update the params of the last render, so two updates before the
// next render (add a filter and close the sheet, often from different components) would
// overwrite each other. The latest unrendered params are shared by every useScope, keyed by
// the location they were built on: once a navigation lands, the rendered params win again.
let pending: { key: string; params: URLSearchParams } | null = null

/**
 * Dashboard state that lives in the URL, shared by every view of a site:
 * period (preset or custom from/to), comparison, chart interval, filters and
 * the open detail sheet.
 */
export function useScope() {
  const { id = "" } = useParams()
  const [params, setParams] = useSearchParams()
  const today = useToday()

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
        : periodRange(period, new Date(today))

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
  }, [params, today])

  const { key } = useLocation()
  useEffect(() => {
    if (pending && pending.key !== key) pending = null
  }, [key])
  const update = useCallback(
    (fn: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(
        pending?.key === key ? pending.params : params
      )
      fn(next)
      pending = { key, params: next }
      setParams(next, { preventScrollReset: true })
    },
    [key, params, setParams]
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
      /** For view-specific parameters (tab, metric, event); keeps quick updates together. */
      updateParams: update,
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
    q.delete("new")
    const s = q.toString()
    return s ? `?${s}` : ""
  }, [params])

  return { siteId: id, ...state, ...actions, search }
}

export type ScopeState = ReturnType<typeof useScope>

export const PICK_RANGE = "mlz:pick-range"

/**
 * Opens the period picker on its calendar from elsewhere (the command menu). An event rather
 * than an import, so the menu does not pull the calendar into the first download.
 */
export const openRangePicker = () => window.dispatchEvent(new Event(PICK_RANGE))

let rangePickers = 0
const rangePickerListeners = new Set<() => void>()
function subscribeRangePickers(changed: () => void) {
  rangePickerListeners.add(changed)
  return () => {
    rangePickerListeners.delete(changed)
  }
}
function countRangePicker(delta: number) {
  rangePickers += delta
  for (const l of rangePickerListeners) l()
}

/** Called by the period picker, so the command menu only offers a range it can open. */
export function useRangePickerMounted() {
  useEffect(() => {
    countRangePicker(1)
    return () => countRangePicker(-1)
  }, [])
}

/** Whether a period picker is on screen to answer openRangePicker. */
export const useHasRangePicker = () =>
  useSyncExternalStore(subscribeRangePickers, () => rangePickers > 0)

/** Sets one parameter in a query string. */
export function withParam(search: string, key: string, value: string): string {
  const q = new URLSearchParams(search)
  q.set(key, value)
  return `?${q.toString()}`
}

/** Adds ?tab=dim to a query string. */
export const withTab = (search: string, dim: string) =>
  withParam(search, "tab", dim)

/**
 * A view parameter that must be one of `allowed`; the default (the first one unless given)
 * is left out of the URL.
 */
export function useParamChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T = allowed[0]!
): [T, (v: T) => void] {
  const [params] = useSearchParams()
  const { updateParams } = useScope()
  const raw = params.get(key)
  const value = allowed.find((a) => a === raw) ?? fallback
  const set = useCallback(
    (v: T) =>
      updateParams((q) => {
        if (v === fallback) q.delete(key)
        else q.set(key, v)
      }),
    [updateParams, key, fallback]
  )
  return [value, set]
}
