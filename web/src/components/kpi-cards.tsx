import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Stats } from "@/lib/api"
import {
  change,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type Metric = {
  label: string
  value: (s: Stats["summary"]) => number
  format: (n: number) => string
  /** For bounce rate, going down is good. */
  lowerIsBetter?: boolean
}

const METRICS: Metric[] = [
  { label: "Visitors", value: (s) => s.visitors, format: formatNumber },
  { label: "Visits", value: (s) => s.visits, format: formatNumber },
  { label: "Page views", value: (s) => s.pageviews, format: formatNumber },
  {
    label: "Bounce rate",
    value: (s) => s.bounce_rate,
    format: formatPercent,
    lowerIsBetter: true,
  },
  {
    label: "Visit duration",
    value: (s) => s.avg_duration,
    format: formatDuration,
  },
]

export function KpiCards({ stats }: { stats?: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {METRICS.map((m) => (
        <Card key={m.label} size="sm">
          <CardHeader>
            <CardDescription>{m.label}</CardDescription>
            {stats ? (
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {m.format(m.value(stats.summary))}
              </p>
            ) : (
              <Skeleton className="h-8 w-20" />
            )}
          </CardHeader>
          <CardContent>
            {stats && <Trend metric={m} stats={stats} />}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function Trend({ metric, stats }: { metric: Metric; stats: Stats }) {
  const delta = change(
    metric.value(stats.summary),
    metric.value(stats.previous)
  )
  if (delta === null)
    return <p className="text-xs text-muted-foreground">No previous data</p>
  if (Math.abs(delta) < 0.005)
    return <p className="text-xs text-muted-foreground">No change</p>

  const up = delta > 0
  const good = metric.lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <p
      className={cn(
        "flex items-center gap-0.5 text-xs font-medium",
        good
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-600 dark:text-rose-400"
      )}
    >
      <Icon className="size-3.5" />
      {formatPercent(Math.abs(delta))}
      <span className="font-normal text-muted-foreground">
        &nbsp;vs previous
      </span>
    </p>
  )
}
