import { format } from "date-fns"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import type { Interval, Stats } from "@/lib/api"
import { change, formatSignedPercent } from "@/lib/format"
import type { Metric } from "@/lib/metrics"
import { cn } from "@/lib/utils"

export const AXIS_FORMAT: Record<Interval, string> = {
  hour: "HH:mm",
  day: "d MMM",
  week: "d MMM",
  month: "MMM yy",
}
export const TOOLTIP_FORMAT: Record<Interval, string> = {
  hour: "EEE d MMM, HH:mm",
  day: "EEE d MMM yyyy",
  week: "'Week of' d MMM yyyy",
  month: "MMMM yyyy",
}
export const BUCKET_MS: Record<Interval, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
}

export const AXIS_TICK = {
  fontSize: 11,
  fill: "var(--fg-muted)",
}

const config = {
  current: { label: "This period", color: "var(--chart-1)" },
  previous: { label: "Comparison", color: "var(--chart-2)" },
} satisfies ChartConfig

type Point = {
  time: number
  prevTime?: number
  /** The bucket's value; null for buckets in the future. */
  value: number | null
  /** value, except for an unfinished bucket, which is drawn separately. */
  current: number | null
  /** The dashed tail into the unfinished bucket. */
  tail?: number
  previous?: number
  partial: boolean
}

/**
 * The main time series: an area for the period, a dashed line for the
 * comparison period (aligned bucket by bucket), and the unfinished bucket
 * drawn as a dotted tail so it doesn't look like a sudden drop.
 */
export function TrafficChart({
  stats,
  metric,
  now,
  className,
  compact,
}: {
  stats?: Stats
  metric: Metric
  /** When stats was fetched (ms); later buckets have no data yet. */
  now: number
  className?: string
  /** Smaller, for the detail sheet. */
  compact?: boolean
}) {
  const interval = stats?.period.interval ?? "day"
  const prevSeries = stats?.previous_timeseries

  const data: Point[] =
    stats?.timeseries.map((b, i) => {
      const time = new Date(b.t).getTime()
      const prev = prevSeries?.[i]
      const value = time > now ? null : metric.value(b)
      const partial = time <= now && now < time + BUCKET_MS[interval]
      return {
        time,
        prevTime: prev ? new Date(prev.t).getTime() : undefined,
        value,
        current: partial ? null : value,
        previous: prev ? metric.value(prev) : undefined,
        partial,
      }
    }) ?? []
  const p = data.findIndex((d) => d.partial)
  if (p >= 0) {
    data[p]!.tail = data[p]!.value ?? undefined
    if (p > 0) data[p - 1]!.tail = data[p - 1]!.value ?? undefined
  }
  const partialTime = p >= 0 && data.length > 1 ? data[p]!.time : undefined
  const height = compact ? "h-44" : "h-72"

  if (!stats) return <Skeleton className={cn(height, className)} />
  const total = stats.timeseries.reduce((n, b) => n + b.pageviews, 0)
  if (total === 0)
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 text-center",
          height,
          className
        )}
      >
        <p className="text-sm font-medium text-fg-secondary">Quiet so far</p>
        <p className="text-xs text-fg-muted">No visits in this period yet.</p>
      </div>
    )

  return (
    <ChartContainer
      config={config}
      className={cn("aspect-auto w-full", height, className)}
    >
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fill-current" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--chart-fill)"
              stopOpacity={0.28}
            />
            <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
          allowDecimals={metric.key === "views_per_visit"}
          tick={AXIS_TICK}
          tickCount={compact ? 3 : 5}
          tickFormatter={(n: number) => metric.format(n)}
        />
        {partialTime !== undefined && (
          <ReferenceLine
            x={partialTime}
            stroke="var(--border-strong)"
            strokeDasharray="2 3"
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--fg-muted)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            const pt = payload?.[0]?.payload as Point | undefined
            if (!active || !pt) return null
            return <ChartTip point={pt} interval={interval} metric={metric} />
          }}
        />
        {prevSeries && (
          <Line
            dataKey="previous"
            type="monotone"
            stroke="var(--color-previous)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            strokeOpacity={0.8}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        )}
        <Line
          dataKey="tail"
          type="monotone"
          stroke="var(--color-current)"
          strokeWidth={2}
          strokeDasharray="2 4"
          strokeLinecap="round"
          dot={false}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Area
          dataKey="current"
          type="monotone"
          stroke="var(--color-current)"
          strokeWidth={2}
          fill="url(#fill-current)"
          activeDot={{
            r: 4,
            strokeWidth: 2,
            stroke: "var(--surface)",
            fill: "var(--color-current)",
          }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ChartContainer>
  )
}

export function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string
  label: string
  dashed?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="16" height="4" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="16"
          y2="2"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "3 3" : undefined}
        />
      </svg>
      {label}
    </span>
  )
}

export function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-2.5 text-xs shadow-(--shadow-pop)">
      {children}
    </div>
  )
}

export function TipRow({
  color,
  label,
  value,
  dashed,
}: {
  color: string
  label: string
  value: string
  dashed?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 items-center gap-2 text-fg-secondary">
        <span
          className="h-0 w-3 shrink-0 border-t-2"
          style={{
            borderColor: color,
            borderStyle: dashed ? "dashed" : "solid",
          }}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="tnum font-medium text-fg">{value}</span>
    </div>
  )
}

function ChartTip({
  point,
  interval,
  metric,
}: {
  point: Point
  interval: Interval
  metric: Metric
}) {
  const delta =
    point.value !== null && point.previous !== undefined
      ? change(point.value, point.previous)
      : null
  const good = delta !== null && (metric.lowerIsBetter ? delta < 0 : delta > 0)
  return (
    <TipBox>
      <p className="font-medium text-fg">
        {format(point.time, TOOLTIP_FORMAT[interval])}
        {point.partial && <span className="text-fg-muted"> · so far</span>}
      </p>
      <TipRow
        color="var(--chart-1)"
        label={metric.label}
        value={point.value === null ? "–" : metric.format(point.value)}
      />
      {point.previous !== undefined && point.prevTime !== undefined && (
        <TipRow
          color="var(--chart-2)"
          label={format(point.prevTime, TOOLTIP_FORMAT[interval])}
          value={metric.format(point.previous)}
          dashed
        />
      )}
      {delta !== null && Math.abs(delta) >= 0.005 && (
        <p
          className={cn(
            "tnum border-t pt-1.5",
            good ? "text-positive" : "text-negative"
          )}
        >
          {formatSignedPercent(delta)}{" "}
          <span className="text-fg-muted">vs comparison</span>
        </p>
      )}
    </TipBox>
  )
}
