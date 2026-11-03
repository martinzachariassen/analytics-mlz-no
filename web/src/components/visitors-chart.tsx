import { useState } from "react"
import { format } from "date-fns"
import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  XAxis,
  YAxis,
} from "recharts"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Interval, Stats } from "@/lib/api"
import { change, formatNumber, formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

const config = {
  current: { label: "This period", color: "var(--chart-1)" },
  previous: { label: "Previous period", color: "var(--chart-2)" },
} satisfies ChartConfig

type Series = "visitors" | "pageviews"
const SERIES_LABEL: Record<Series, string> = {
  visitors: "Visitors",
  pageviews: "Page views",
}

const AXIS_FORMAT: Record<Interval, string> = {
  hour: "HH:mm",
  day: "d MMM",
  month: "MMM yyyy",
}
const TOOLTIP_FORMAT: Record<Interval, string> = {
  hour: "EEE d MMM, HH:mm",
  day: "EEE d MMM yyyy",
  month: "MMMM yyyy",
}
const BUCKET_MS: Record<Interval, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  month: 31 * 86_400_000,
}

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

export function VisitorsChart({
  stats,
  previous,
  now,
}: {
  stats?: Stats
  /** The period before, drawn as a dashed comparison line. */
  previous?: Stats
  /** When stats was fetched (ms); later buckets have no data yet. */
  now: number
}) {
  const [series, setSeries] = useState<Series>("visitors")
  const interval = stats?.period.interval ?? "day"

  // Line up the previous period bucket by bucket, so day 1 sits on top of day 1.
  const data: Point[] =
    stats?.timeseries.map((b, i) => {
      const time = new Date(b.t).getTime()
      const prev = previous?.timeseries[i]
      // Buckets in the future (later today) have no data yet: leave a gap, not a drop to 0.
      const value = time > now ? null : b[series]
      const partial = time <= now && now < time + BUCKET_MS[interval]
      return {
        time,
        prevTime: prev ? new Date(prev.t).getTime() : undefined,
        value,
        current: partial ? null : value,
        previous: prev?.[series],
        partial,
      }
    }) ?? []
  // An unfinished bucket (this month, today, this hour) would look like a sudden drop.
  // Draw it as a dashed tail from the last complete bucket instead.
  const p = data.findIndex((d) => d.partial)
  if (p >= 0) {
    data[p]!.tail = data[p]!.value ?? undefined
    if (p > 0) data[p - 1]!.tail = data[p - 1]!.value ?? undefined
  }

  const total = stats?.timeseries.reduce((n, b) => n + b[series], 0) ?? 0

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Traffic over time</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendItem color="var(--chart-1)" label="This period" />
          <LegendItem color="var(--chart-2)" label="Previous period" dashed />
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={series}
            onValueChange={(v) => v && setSeries(v as Series)}
          >
            <ToggleGroupItem value="visitors">Visitors</ToggleGroupItem>
            <ToggleGroupItem value="pageviews">Page views</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <Skeleton className="h-72 w-full" />
        ) : total === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            No visits in this period yet
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-72 w-full">
            <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="fill-current" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-current)"
                    stopOpacity={0.28}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-current)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="0" />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={40}
                tickFormatter={(t: number) => format(t, AXIS_FORMAT[interval])}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickFormatter={(n: number) => formatNumber(n)}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as Point | undefined
                  if (!active || !p) return null
                  return (
                    <ChartTip
                      point={p}
                      interval={interval}
                      label={SERIES_LABEL[series]}
                    />
                  )
                }}
              />
              {previous && (
                <Line
                  dataKey="previous"
                  type="monotone"
                  stroke="var(--color-previous)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
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
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function LegendItem({
  color,
  label,
  dashed,
}: {
  color: string
  label: string
  dashed?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
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

function ChartTip({
  point,
  interval,
  label,
}: {
  point: Point
  interval: Interval
  label: string
}) {
  const delta =
    point.value !== null && point.previous !== undefined
      ? change(point.value, point.previous)
      : null
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">
        {format(point.time, TOOLTIP_FORMAT[interval])}
        {point.partial && (
          <span className="ml-1 font-normal text-muted-foreground">
            (so far)
          </span>
        )}
      </p>
      <Row
        color="var(--chart-1)"
        label={label}
        value={point.value === null ? "–" : formatNumber(point.value)}
      />
      {point.previous !== undefined && point.prevTime !== undefined && (
        <Row
          color="var(--chart-2)"
          label={format(point.prevTime, TOOLTIP_FORMAT[interval])}
          value={formatNumber(point.previous)}
          dashed
        />
      )}
      {delta !== null && (
        <p
          className={cn(
            "font-medium tabular-nums",
            delta >= 0
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-rose-700 dark:text-rose-400"
          )}
        >
          {formatSignedPercent(delta)} vs previous period
        </p>
      )}
    </div>
  )
}

function Row({
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
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span
          className={cn(
            "h-0.5 w-3 rounded-full",
            dashed && "border-t-2 border-dashed bg-transparent"
          )}
          style={dashed ? { borderColor: color } : { background: color }}
        />
        {label}
      </span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  )
}
