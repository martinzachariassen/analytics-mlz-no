import type { ReactNode } from "react"
import { format } from "date-fns"
import { Sparkles } from "lucide-react"

import type { Stats } from "@/lib/api"
import { change, formatNumber, formatPercent } from "@/lib/format"
import { useBreakdown } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"

const BUSIEST_FORMAT = {
  hour: "HH:mm",
  day: "EEEE d MMM",
  week: "'the week of' d MMM",
  month: "MMMM",
}

/** One or two plain-language sentences about the period, from data loaded anyway. */
export function Insights({ stats }: { stats?: Stats }) {
  const sc = useScope()
  // Same query as the Sources card, so it comes from the cache.
  const referrers = useBreakdown(sc.siteId, sc.scope, "referrer", { limit: 8 })
  if (!stats || !referrers.data) return <div className="h-5" />
  const { visitors } = stats.summary
  if (visitors === 0) return <div className="h-5" />

  const items: ReactNode[] = []
  const delta = sc.compare ? change(visitors, stats.previous.visitors) : null
  if (delta !== null) {
    items.push(
      Math.abs(delta) < 0.02 ? (
        <>Visitors are flat against the comparison period.</>
      ) : (
        <>
          Visitors are{" "}
          <Strong>
            {delta > 0 ? "up" : "down"} {formatPercent(Math.abs(delta))}
          </Strong>
          .
        </>
      )
    )
  }
  const top = referrers.data.find((r) => r.value !== "")
  if (top)
    items.push(
      <>
        <Strong>{top.value}</Strong> is the top referrer (
        {formatPercent(top.visitors / visitors)} of visitors).
      </>
    )
  const busiest = stats.timeseries.reduce(
    (best, b) => (b.visitors > best.visitors ? b : best),
    stats.timeseries[0]!
  )
  if (stats.timeseries.length > 1 && busiest.visitors > 0)
    items.push(
      <>
        Busiest was{" "}
        <Strong>
          {format(new Date(busiest.t), BUSIEST_FORMAT[stats.period.interval])}
        </Strong>{" "}
        with {formatNumber(busiest.visitors)} visitors.
      </>
    )

  return (
    <p className="flex items-start gap-2 text-[13px] text-pretty text-fg-secondary">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
      <span>
        {items.map((it, i) => (
          <span key={i}>
            {it}
            {i < items.length - 1 && " "}
          </span>
        ))}
      </span>
    </p>
  )
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-fg">{children}</span>
}
