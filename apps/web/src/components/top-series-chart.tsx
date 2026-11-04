import { keepPreviousData, useQueries } from "@tanstack/react-query"
import { format } from "date-fns"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  AXIS_FORMAT,
  AXIS_TICK,
  TipBox,
  TipRow,
  TOOLTIP_FORMAT,
} from "@/components/traffic-chart"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type BreakdownRow, type FilterDim } from "@/lib/api"
import { formatValue } from "@/lib/dims"
import { formatNumber } from "@/lib/format"
import type { ScopeState } from "@/lib/use-scope"

const SERIES = 5

/**
 * Visitors over time for the top values of a dimension, one line each. The
 * colours follow the entity's rank in the table below, in the fixed
 * categorical order.
 */
export function TopSeriesChart({
  sc,
  dim,
  rows,
}: {
  sc: ScopeState
  dim: FilterDim
  rows?: BreakdownRow[]
}) {
  const top = (rows ?? []).slice(0, SERIES)
  const results = useQueries({
    queries: top.map((r) => {
      const scope = {
        ...sc.scope,
        compare: undefined,
        filters: [
          ...sc.filters.filter((f) => f.dim !== dim),
          { dim, op: "is" as const, value: r.value },
        ],
      }
      return {
        queryKey: ["stats", sc.siteId, scope, sc.interval],
        queryFn: () => api.stats(sc.siteId, scope, { interval: sc.interval }),
        placeholderData: keepPreviousData,
      }
    }),
  })

  if (!rows || results.some((r) => !r.data))
    return <Skeleton className="h-64" />
  if (top.length === 0)
    return (
      <div className="flex h-64 items-center justify-center text-xs text-fg-muted">
        Nothing in this period
      </div>
    )

  const first = results[0]!.data!
  const interval = first.period.interval
  const now = results[0]!.dataUpdatedAt
  const data = first.timeseries.map((b, i) => {
    const time = new Date(b.t).getTime()
    const point: Record<string, number | null> = { time }
    results.forEach((r, s) => {
      point[`s${s}`] =
        time > now ? null : (r.data!.timeseries[i]?.visitors ?? 0)
    })
    return point
  })
  const config = Object.fromEntries(
    top.map((r, s) => [
      `s${s}`,
      { label: formatValue(dim, r.value), color: `var(--series-${s + 1})` },
    ])
  )

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={48}
            tick={AXIS_TICK}
            tickFormatter={(t: number) => format(t, AXIS_FORMAT[interval])}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            tick={AXIS_TICK}
            tickFormatter={(n: number) => formatNumber(n)}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--fg-muted)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              const pt = payload?.[0]?.payload as
                | Record<string, number | null>
                | undefined
              if (!active || !pt) return null
              return (
                <TipBox>
                  <p className="font-medium text-fg">
                    {format(pt.time!, TOOLTIP_FORMAT[interval])}
                  </p>
                  {top.map((r, s) => (
                    <TipRow
                      key={r.value}
                      color={`var(--series-${s + 1})`}
                      label={formatValue(dim, r.value)}
                      value={formatNumber(pt[`s${s}`] ?? 0)}
                    />
                  ))}
                </TipBox>
              )
            }}
          />
          {top.map((r, s) => (
            <Line
              key={r.value}
              dataKey={`s${s}`}
              type="monotone"
              stroke={`var(--series-${s + 1})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)" }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-fg-secondary">
        {top.map((r, s) => (
          <li key={r.value} className="flex min-w-0 items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: `var(--series-${s + 1})` }}
            />
            <span className="max-w-48 truncate">
              {formatValue(dim, r.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
