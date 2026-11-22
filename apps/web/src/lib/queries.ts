import { hashKey, type QueryKey, useQuery } from "@tanstack/react-query"

import {
  api,
  type Dimension,
  type Interval,
  type Scope,
  type Site,
} from "@/lib/api"

/** The signed-in user. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me })
}

/** How often the realtime numbers refresh. */
export const REALTIME_POLL_MS = 10_000

/**
 * Live visitors, shared by the sidebar badge and the Realtime page so one poll serves both.
 * `detail` adds the per-minute series and the top lists, which only the Realtime page shows.
 */
export function useRealtime(siteId: string, detail = false) {
  return useQuery({
    queryKey: ["realtime", siteId, detail ? "detail" : "count"],
    queryFn: () => api.realtime(siteId, detail),
    refetchInterval: detail ? REALTIME_POLL_MS : 15_000,
  })
}

/** How often a site waiting for its first event is re-fetched right after it was added. */
export const WAITING_POLL_MS = 5_000
/** The interval for a site that has waited longer than FAST_POLL_FOR_MS, and for "live" views. */
export const IDLE_POLL_MS = 60_000
const FAST_POLL_FOR_MS = 60 * 60_000

/**
 * How often to re-fetch a site so onboarding moves on by itself when its first event is
 * stored: every 5 s for the first hour after it was added, then every minute, so a site
 * that was never installed does not keep every open tab busy. False once it has data.
 */
export function waitingPoll(site: Site, now = Date.now()): number | false {
  if (site.first_event_at !== null) return false
  return now - Date.parse(site.created_at) < FAST_POLL_FOR_MS
    ? WAITING_POLL_MS
    : IDLE_POLL_MS
}

/**
 * One site, polled while it waits for its first event. `live` keeps polling once it has
 * data, for views that show when the last event arrived.
 */
export function useSite(siteId: string, { live = false } = {}) {
  return useQuery({
    queryKey: ["site", siteId],
    queryFn: () => api.site(siteId),
    refetchInterval: (q) => {
      const site = q.state.data
      if (!site) return false
      return waitingPoll(site) || (live ? IDLE_POLL_MS : false)
    },
  })
}

/** All sites, polled at the pace of the most recently added site that is still waiting. */
export function useSites() {
  return useQuery({
    queryKey: ["sites"],
    queryFn: api.sites,
    refetchInterval: (q) => {
      const polls = (q.state.data ?? [])
        .map((s) => waitingPoll(s))
        .filter((ms) => ms !== false)
      return polls.length > 0 ? Math.min(...polls) : false
    },
  })
}

/**
 * Like keepPreviousData, but only while the query still shows the same thing: a new period or
 * filter keeps the old numbers on screen until the new ones arrive, while a new site, tab or
 * event starts empty, so old rows never appear (and can be clicked) under a new heading.
 * `view` is the part of the key that names what is shown, without the scope. Spread the result
 * into the query's options.
 */
export function keepPreviousFor(view: QueryKey) {
  const id = hashKey(view)
  return {
    meta: { view: id },
    placeholderData: <T>(
      previous: T | undefined,
      previousQuery: { meta?: Record<string, unknown> } | undefined
    ): T | undefined =>
      previousQuery?.meta?.view === id ? previous : undefined,
  }
}

export function useGoals(siteId: string) {
  return useQuery({
    queryKey: ["goals", siteId],
    queryFn: () => api.goals(siteId),
  })
}

/** Conversions per goal. Shares the "goals" key prefix, so changing goals refetches it. */
export function useGoalStats(siteId: string, scope: Scope, enabled = true) {
  return useQuery({
    queryKey: ["goals", siteId, "stats", scope],
    queryFn: () => api.goalStats(siteId, scope),
    ...keepPreviousFor([siteId]),
    enabled,
  })
}

export function useStats(
  siteId: string,
  scope: Scope,
  interval?: Interval,
  enabled = true
) {
  return useQuery({
    queryKey: ["stats", siteId, scope, interval],
    queryFn: () => api.stats(siteId, scope, { interval }),
    ...keepPreviousFor([siteId]),
    enabled,
  })
}

export type BreakdownOpts = {
  limit?: number
  event?: string
  key?: string
  metrics?: "full"
}

/** A longer list (a new limit) of the same rows keeps the shorter one on screen meanwhile. */
const breakdownView = (siteId: string, dim: Dimension, o: BreakdownOpts) => [
  siteId,
  dim,
  o.event ?? "",
  o.key ?? "",
  o.metrics ?? "",
]

export function useBreakdown(
  siteId: string,
  scope: Scope,
  dim: Dimension,
  opts: BreakdownOpts = {},
  enabled = true
) {
  return useQuery({
    queryKey: ["breakdown", siteId, scope, dim, opts],
    queryFn: () => api.breakdown(siteId, scope, dim, opts),
    ...keepPreviousFor(breakdownView(siteId, dim, opts)),
    enabled,
  })
}
