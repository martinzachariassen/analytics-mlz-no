import { Info } from "lucide-react"
import { useState } from "react"

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
        const series =
          stats?.timeseries
            .filter((b) => new Date(b.t).getTime() <= now)
            .map((b) => m.value(b)) ?? []
        return (
          <div
            key={m.key}
            className={cn(
              "relative flex min-w-0 flex-col gap-2 bg-surface px-4 pt-3.5 pb-3 text-left",
              onMetric &&
                "transition-colors focus-within:bg-surface-2 hover:bg-surface-2",
              active && "bg-surface-2"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 h-0.5 bg-violet transition-opacity",
                active ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="flex items-center gap-1.5">
              {onMetric ? (
                // The ::after covers the whole tile, so the tile is one big target while the
                // help button next to it stays a separate one.
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onMetric(m.key)}
                  className={cn(
                    "text-xs font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent focus-visible:after:ring-inset",
                    active ? "text-fg" : "text-fg-muted"
                  )}
                >
                  {m.label}
                </button>
              ) : (
                <span className="text-xs font-medium text-fg-muted">
                  {m.label}
                </span>
              )}
              <HelpTip label={m.label} help={m.help} />
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
          </div>
        )
      })}
    </div>
  )
}

/** What a metric means: on hover, on keyboard focus and on tap. */
function HelpTip({ label, help }: { label: string; help: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          onClick={(e) => {
            // Radix closes a tooltip on click, but a tap is how touch screens ask for one.
            e.preventDefault()
            setOpen(true)
          }}
          className="relative z-10 -m-1 rounded-sm p-1 text-fg-muted/60 transition-colors hover:text-fg focus-visible:text-fg"
        >
          <Info className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{help}</TooltipContent>
    </Tooltip>
  )
}
