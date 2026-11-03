import type { ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { Lightbulb } from "lucide-react"

import { PAGE } from "@/components/breakdown-card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type RangeParams, type Stats, type Summary } from "@/lib/api"
import { change, formatNumber, formatPercent } from "@/lib/format"

const BUSIEST_FORMAT = { hour: "HH:mm", day: "EEEE d MMM", month: "MMMM" }

/** A few plain-language sentences about the period, derived from data the dashboard loads anyway. */
export function Insights({
  siteId,
  range,
  stats,
  previous,
}: {
  siteId: string
  range: RangeParams
  stats?: Stats
  previous?: Summary
}) {
  // Same query keys as the breakdown cards, so these come from the cache.
  const referrers = useQuery({
    queryKey: ["breakdown", siteId, range, "referrer", PAGE],
    queryFn: () => api.breakdown(siteId, range, "referrer", { limit: PAGE }),
  })
  const pages = useQuery({
    queryKey: ["breakdown", siteId, range, "path", PAGE],
    queryFn: () => api.breakdown(siteId, range, "path", { limit: PAGE }),
  })

  if (!stats || !previous || !referrers.data || !pages.data) {
    return <Skeleton className="h-14" />
  }
  const { visitors } = stats.summary
  if (visitors === 0) return null

  const items: ReactNode[] = []

  const delta = change(visitors, previous.visitors)
  if (delta !== null) {
    items.push(
      Math.abs(delta) < 0.02 ? (
        <>Visitor numbers are about the same as the previous period.</>
      ) : (
        <>
          Visitors are{" "}
          <Strong>
            {delta > 0 ? "up" : "down"} {formatPercent(Math.abs(delta))}
          </Strong>{" "}
          compared with the previous period ({formatNumber(visitors)} vs{" "}
          {formatNumber(previous.visitors)}).
        </>
      )
    )
  }

  const topSource = referrers.data.find((r) => r.value !== "")
  if (topSource) {
    items.push(
      <>
        The top referring website is <Strong>{topSource.value}</Strong>,
        bringing {formatPercent(topSource.visitors / visitors)} of all visitors.
      </>
    )
  }

  const busiest = stats.timeseries.reduce(
    (best, b) => (b.visitors > best.visitors ? b : best),
    stats.timeseries[0]!
  )
  if (stats.timeseries.length > 1 && busiest.visitors > 0) {
    items.push(
      <>
        The busiest {stats.period.interval} was{" "}
        <Strong>
          {format(new Date(busiest.t), BUSIEST_FORMAT[stats.period.interval])}
        </Strong>{" "}
        with {formatNumber(busiest.visitors)} visitors.
      </>
    )
  } else if (pages.data[0]) {
    items.push(
      <>
        The most viewed page is <Strong>{pages.data[0].value}</Strong>.
      </>
    )
  }

  return (
    <div className="flex gap-3 rounded-xl border border-chart-1/20 bg-chart-1/5 px-4 py-3 text-sm">
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-chart-1" />
      <ul className="flex flex-col gap-1 text-muted-foreground">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}
