import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { api, type Dimension, type Interval, type Scope } from "@/lib/api"

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
