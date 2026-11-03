import { Info } from "lucide-react"

import { Delta } from "@/components/delta"
import { Sparkline } from "@/components/sparkline"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Stats } from "@/lib/api"
import { METRICS, type MetricKey } from "@/lib/metrics"
import { cn } from "@/lib/utils"

/**
 * The headline numbers. Each tile shows the value, the change against the
 * comparison period and a sparkline; clicking one puts it in the main chart.
 */
export function KpiStrip({
  stats,
  metric,
  onMetric,
  now,
  className,
}: {
  stats?: Stats
  metric?: MetricKey
  onMetric?: (m: MetricKey) => void
  now: number
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 xl:grid-cols-6",
        className
      )}
    >
      {METRICS.map((m) => {
        const active = m.key === metric
        const Cell = onMetric ? "button" : "div"
        const series =
          stats?.timeseries
            .filter((b) => new Date(b.t).getTime() <= now)
            .map((b) => m.value(b)) ?? []
        return (
          <Cell
            key={m.key}
            type={onMetric ? "button" : undefined}
            aria-pressed={onMetric ? active : undefined}
            onClick={onMetric ? () => onMetric(m.key) : undefined}
            className={cn(
              "group relative flex min-w-0 flex-col gap-2 bg-surface px-4 pt-3.5 pb-3 text-left",
              onMetric && "transition-colors hover:bg-surface-2",
              active && "bg-surface-2"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 h-0.5 bg-accent transition-opacity",
                active ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "text-xs font-medium",
                  active ? "text-fg" : "text-fg-muted"
                )}
              >
                {m.label}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    aria-label={`About ${m.label}`}
                    className="text-fg-muted/60 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
                  >
                    <Info className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{m.help}</TooltipContent>
              </Tooltip>
            </span>
            {stats ? (
              <>
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="figure text-[26px] text-fg">
                    {m.format(m.value(stats.summary))}
                  </span>
                  <Delta
                    current={m.value(stats.summary)}
                    previous={m.value(stats.previous)}
                    lowerIsBetter={m.lowerIsBetter}
                  />
                </span>
                <Sparkline
                  values={series}
                  color={active ? "var(--accent)" : "var(--fg-muted)"}
                  className={cn(!active && "opacity-60")}
                />
              </>
            ) : (
              <>
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-8 w-full" />
              </>
            )}
          </Cell>
        )
      })}
    </div>
  )
}
