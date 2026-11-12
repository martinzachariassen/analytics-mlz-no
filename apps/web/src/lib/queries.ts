import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { api, type Dimension, type Interval, type Scope } from "@/lib/api"

/** How often a site without data is re-fetched to notice its first event. */
export const WAITING_POLL_MS = 5_000

/**
 * One site. While it has never received an event, it is polled so onboarding moves on
 * by itself the moment the first event is stored.
 */
export function useSite(siteId: string) {
  return useQuery({
    queryKey: ["site", siteId],
    queryFn: () => api.site(siteId),
    refetchInterval: (q) =>
      q.state.data && q.state.data.first_event_at === null
        ? WAITING_POLL_MS
        : false,
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
