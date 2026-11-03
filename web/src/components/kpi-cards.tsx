import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Summary } from "@/lib/api"
import {
  change,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type Metric = {
  label: string
  help: string
  value: (s: Summary) => number
  format: (n: number) => string
  /** For bounce rate, going down is good. */
  lowerIsBetter?: boolean
}

const pagesPerVisit = (s: Summary) => (s.visits ? s.pageviews / s.visits : 0)

const METRICS: Metric[] = [
  {
    label: "Visitors",
    help: "Unique people who visited. Someone who comes back on another day is counted again, since no cookies are used.",
    value: (s) => s.visitors,
    format: formatNumber,
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

export function KpiCards({
  summary,
  previous,
}: {
  summary?: Summary
  previous?: Summary
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
      {METRICS.map((m) => (
        <Card key={m.label} className="gap-2 px-4">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            {m.label}
            <Tooltip>
              <TooltipTrigger
                className="rounded-full text-muted-foreground/60 hover:text-foreground"
                aria-label={`About ${m.label}`}
              >
                <Info className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{m.help}</TooltipContent>
            </Tooltip>
          </div>
          {summary && previous ? (
            <>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {m.format(m.value(summary))}
              </p>
              <Trend
                metric={m}
                current={m.value(summary)}
                before={m.value(previous)}
              />
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-24" />
            </>
          )}
        </Card>
      ))}
    </div>
  )
}

function Trend({
  metric,
  current,
  before,
}: {
  metric: Metric
  current: number
  before: number
}) {
  const delta = change(current, before)
  const was = (
    <span className="text-muted-foreground">was {metric.format(before)}</span>
  )
  if (delta === null)
    return <p className="text-xs text-muted-foreground">No earlier data</p>
  if (Math.abs(delta) < 0.005)
    return (
      <p className="flex items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
          <Minus className="size-3" />
          0%
        </span>
        {was}
      </p>
    )

  const up = delta > 0
  const good = metric.lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
          good
            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
        )}
      >
        <Icon className="size-3" />
        {formatSignedPercent(delta)}
      </span>
      {was}
    </p>
  )
}
