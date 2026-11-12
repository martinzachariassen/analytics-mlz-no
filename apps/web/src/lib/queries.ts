import { keepPreviousData, useQuery } from "@tanstack/react-query"

import {
  api,
  type Dimension,
  type Interval,
  type Scope,
  type Site,
} from "@/lib/api"

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
    placeholderData: keepPreviousData,
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
    placeholderData: keepPreviousData,
    enabled,
  })
}

export type BreakdownOpts = {
  limit?: number
  event?: string
  key?: string
  metrics?: "full"
}

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
    placeholderData: keepPreviousData,
    enabled,
  })
}
