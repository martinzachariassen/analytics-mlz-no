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

import { Delta } from "@/components/delta"
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Interval, Stats, Summary } from "@/lib/api"
import {
  change,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"

export type Series = "visitors" | "pageviews"

type Metric = {
  label: string
  help: string
  value: (s: Summary) => number
  format: (n: number) => string
  /** For bounce rate, going down is good. */
  lowerIsBetter?: boolean
  /** The timeseries this metric drives in the chart, when there is one. */
  series?: Series
}

const pagesPerVisit = (s: Summary) => (s.visits ? s.pageviews / s.visits : 0)

const METRICS: Metric[] = [
  {
    label: "Visitors",
    help: "Unique people who visited. Someone who comes back on another day is counted again, since no cookies are used.",
    value: (s) => s.visitors,
    format: formatNumber,
    series: "visitors",
  },
  {
    label: "Visits",
    help: "Separate sessions. A visit ends after 30 minutes without activity, so one visitor can make several visits.",
    value: (s) => s.visits,
    format: formatNumber,
  },
  {
    label: "Page views",
    help: "Every page that was opened, including navigation inside single-page apps.",
    value: (s) => s.pageviews,
    format: formatNumber,
    series: "pageviews",
  },
  {
    label: "Pages / visit",
    help: "Average number of pages viewed per visit. Higher means people explore more.",
    value: pagesPerVisit,
    format: (n) => n.toFixed(1),
  },
  {
    label: "Bounce rate",
    help: "Share of visits that left after viewing a single page. Lower is usually better.",
    value: (s) => s.bounce_rate,
    format: formatPercent,
    lowerIsBetter: true,
  },
  {
    label: "Visit duration",
    help: "Average time between the first and last activity in a visit.",
    value: (s) => s.avg_duration,
    format: formatDuration,
  },
]

const SERIES_LABEL: Record<Series, string> = {
  visitors: "Visitors",
  pageviews: "Page views",
}

/**
 * The headline numbers and the chart in one panel. Clicking Visitors or Page
 * views switches what the chart shows, so the number and its line sit together.
 */
export function Overview({
  stats,
  previous,
  now,
  series,
  onSeriesChange,
}: {
  stats?: Stats
  /** The period before, drawn as a dashed comparison line. */
  previous?: Stats
  /** When stats was fetched (ms); later buckets have no data yet. */
  now: number
  series: Series
  onSeriesChange: (s: Series) => void
}) {
  const summary = stats?.summary
  const prev = previous?.summary
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-surface">
      <div className="grid grid-cols-2 border-b sm:grid-cols-3 xl:grid-cols-6">
        {METRICS.map((m, i) => {
          const active = m.series === series
          const Cell = m.series ? "button" : "div"
          return (
            <Cell
              key={m.label}
              type={m.series ? "button" : undefined}
              aria-pressed={m.series ? active : undefined}
              onClick={m.series ? () => onSeriesChange(m.series!) : undefined}
              className={cn(
                "relative flex min-w-0 flex-col gap-2.5 border-border px-4 py-4 text-left sm:px-5 sm:py-5",
                // Hairlines between cells, at every breakpoint's column count.
                "xl:[&:not(:last-child)]:border-r sm:max-xl:[&:not(:nth-child(3n))]:border-r max-sm:[&:nth-child(odd)]:border-r",
                "sm:max-xl:[&:nth-child(-n+3)]:border-b max-sm:[&:nth-child(-n+4)]:border-b",
                m.series && "transition-colors hover:bg-bg/60",
                active && "bg-bg!"
              )}
            >
              {/* The active metric: a 2px violet line on top, like a tab. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-0.5 bg-accent-deep transition-opacity",
                  active ? "opacity-100" : "opacity-0"
                )}
              />
              <span className="flex items-center gap-1.5">
                <span className={cn("eyebrow", active && "text-fg")}>
                  {m.label}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="img"
                      aria-label={`About ${m.label}`}
                      className="text-[10px] text-fg-muted/70 hover:text-fg"
                    >
                      ⓘ
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">{m.help}</TooltipContent>
                </Tooltip>
              </span>
              {summary && prev ? (
                <>
                  <span
                    className="figure rise text-[30px] text-fg sm:text-[34px]"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    {m.format(m.value(summary))}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Delta
                      current={m.value(summary)}
                      previous={m.value(prev)}
                      lowerIsBetter={m.lowerIsBetter}
                    />
                    <span className="text-[11px] text-fg-muted">
                      was {m.format(m.value(prev))}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-3.5 w-24" />
                </>
              )}
            </Cell>
          )
        })}
      </div>
      <div className="px-2 pt-5 pb-3 sm:px-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
          <span className="eyebrow text-fg-secondary">
            {SERIES_LABEL[series]} over time
          </span>
          <span className="flex items-center gap-4 text-[11px] text-fg-muted">
            <LegendItem color="var(--chart-1)" label="This period" />
            <LegendItem color="var(--chart-2)" label="Previous" dashed />
          </span>
        </div>
        <TrafficChart
          stats={stats}
          previous={previous}
          now={now}
          series={series}
        />
      </div>
    </section>
  )
}

const config = {
  current: { label: "This period", color: "var(--chart-1)" },
  previous: { label: "Previous period", color: "var(--chart-2)" },
} satisfies ChartConfig

const AXIS_FORMAT: Record<Interval, string> = {
  hour: "HH:mm",
  day: "d MMM",
  month: "MMM yy",
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

const AXIS_TICK = {
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  fill: "var(--fg-muted)",
}

function TrafficChart({
  stats,
  previous,
  now,
  series,
}: {
  stats?: Stats
  previous?: Stats
  now: number
  series: Series
}) {
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
  const partialTime = p >= 0 ? data[p]!.time : undefined

  const total = stats?.timeseries.reduce((n, b) => n + b[series], 0) ?? 0

  if (!stats) return <Skeleton className="mx-2 h-72" />
  if (total === 0)
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <p className="display text-2xl text-fg-secondary">Quiet so far</p>
        <p className="text-xs text-fg-muted">No visits in this period yet.</p>
      </div>
    )

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <ComposedChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="fill-current" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-fill)" stopOpacity={0.3} />
            <stop
              offset="100%"
              stopColor="var(--chart-fill)"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="2 4"
        />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
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
        {partialTime !== undefined && (
          <ReferenceLine
            x={partialTime}
            stroke="var(--fg-muted)"
            strokeDasharray="1 3"
            label={{
              value: "NOW",
              position: "insideTopRight",
              fontSize: 10,
              letterSpacing: "0.14em",
              fontFamily: "var(--font-mono)",
              fill: "var(--fg-muted)",
            }}
          />
        )}
        <ChartTooltip
          cursor={{ stroke: "var(--fg)", strokeWidth: 1, strokeOpacity: 0.4 }}
          content={({ active, payload }) => {
            const pt = payload?.[0]?.payload as Point | undefined
            if (!active || !pt) return null
            return (
              <ChartTip
                point={pt}
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
          activeDot={{
            r: 4.5,
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
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="4" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="18"
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

/** The brand's tooltip: page background, --fg border, hard violet shadow. */
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
    <div className="grid min-w-48 gap-2 rounded-lg border-[1.5px] border-fg bg-bg px-3 py-2.5 text-xs shadow-[4px_4px_0_0_var(--accent-deep)]">
      <p className="eyebrow text-fg">
        {format(point.time, TOOLTIP_FORMAT[interval])}
        {point.partial && <span className="text-fg-muted"> · so far</span>}
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
        <p className="tnum border-t pt-2 text-fg-secondary">
          <span className={delta >= 0 ? "text-accent-deep" : undefined}>
            {delta >= 0 ? "▲" : "▼"} {formatSignedPercent(delta)}
          </span>{" "}
          vs previous
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
      <span className="flex items-center gap-2 text-fg-muted">
        <span
          className="h-0 w-3 border-t-2"
          style={{
            borderColor: color,
            borderStyle: dashed ? "dashed" : "solid",
          }}
        />
        {label}
      </span>
      <span className="tnum text-fg">{value}</span>
    </div>
  )
}
