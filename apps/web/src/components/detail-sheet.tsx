import { ArrowUpRight, ListFilter } from "lucide-react"
import { Link } from "react-router"

import { BarList } from "@/components/bar-list"
import { Delta } from "@/components/delta"
import { ErrorNote } from "@/components/error-note"
import { GoalButton } from "@/components/goal-button"
import { TrafficChart } from "@/components/traffic-chart"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import type { Dimension, FilterDim, Scope } from "@/lib/api"
import { DIM_VIEW, DIMS, formatValue } from "@/lib/dims"
import { formatPercent } from "@/lib/format"
import { goalKindFor } from "@/lib/goals"
import { METRIC, type MetricKey } from "@/lib/metrics"
import { useBreakdown, useStats } from "@/lib/queries"
import { type Detail, useScope } from "@/lib/use-scope"

/** What to break a value down by, per kind of dimension. */
const RELATED: Record<string, Dimension[]> = {
  page: ["referrer", "country", "device"],
  source: ["entry", "country", "device"],
  visitor: ["path", "referrer", "browser"],
  event: ["path", "referrer", "country"],
}
const KIND: Record<FilterDim, keyof typeof RELATED> = {
  path: "page",
  entry: "page",
  exit: "page",
  hostname: "page",
  referrer: "source",
  utm_source: "source",
  utm_medium: "source",
  utm_campaign: "source",
  country: "visitor",
  browser: "visitor",
  os: "visitor",
  device: "visitor",
  event: "event",
}

const SHEET_METRICS: MetricKey[] = [
  "visitors",
  "visits",
  "pageviews",
  "bounce_rate",
  "avg_duration",
]

/**
 * A slide-in panel with everything about one value (a page, a source, a
 * country…): its numbers, trend and what it breaks down into. Opened from any
 * list; its state is in the URL (?detail=dim:value).
 */
export function DetailSheet() {
  const sc = useScope()
  const d = sc.detail
  return (
    <Sheet open={d !== null} onOpenChange={(o) => !o && sc.openDetail(null)}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {d && <DetailBody d={d} />}
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({ d }: { d: Detail }) {
  const sc = useScope()
  const scope: Scope = {
    ...sc.scope,
    filters: [
      ...sc.filters.filter((f) => f.dim !== d.dim),
      { dim: d.dim, op: "is", value: d.value },
    ],
  }
  const stats = useStats(sc.siteId, scope, sc.interval)
  const all = useStats(sc.siteId, sc.scope, sc.interval)
  const view = DIM_VIEW[d.dim]
  const goalKind = goalKindFor(d.dim)
  const title = formatValue(d.dim, d.value)
  const share =
    stats.data && all.data?.summary.visitors
      ? stats.data.summary.visitors / all.data.summary.visitors
      : undefined

  return (
    <>
      <SheetHeader className="gap-3 border-b p-5 pr-12">
        <SheetDescription className="text-xs font-medium">
          {DIMS[d.dim].label}
        </SheetDescription>
        <SheetTitle className="font-mono text-[15px]! break-all">
          {title}
        </SheetTitle>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              sc.addFilter({ dim: d.dim, op: "is", value: d.value })
              sc.openDetail(null)
            }}
          >
            <ListFilter />
            Filter dashboard by this
          </Button>
          {goalKind && (
            <GoalButton siteId={sc.siteId} kind={goalKind} value={d.value} />
          )}
          {view && (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/sites/${sc.siteId}/${view}${sc.search}`}>
                Open {view}
                <ArrowUpRight />
              </Link>
            </Button>
          )}
        </div>
      </SheetHeader>

      {stats.isError && <ErrorNote queries={[stats]} className="px-5" />}
      <div className="grid grid-cols-3 gap-px border-b bg-border">
        {SHEET_METRICS.map((k) => {
          const m = METRIC[k]
          return (
            <div key={k} className="flex flex-col gap-1 bg-bg px-4 py-3">
              <span className="text-[11px] font-medium text-fg-muted">
                {m.label}
              </span>
              {stats.isError ? (
                <span className="figure text-lg text-fg-muted">–</span>
              ) : stats.data ? (
                <>
                  <span className="figure text-lg">
                    {m.format(m.value(stats.data.summary))}
                  </span>
                  <Delta
                    className="self-start"
                    current={m.value(stats.data.summary)}
                    previous={m.value(stats.data.previous)}
                    lowerIsBetter={m.lowerIsBetter}
                  />
                </>
              ) : (
                <Skeleton className="h-10" />
              )}
            </div>
          )
        })}
        <div className="flex flex-col gap-1 bg-bg px-4 py-3">
          <span className="text-[11px] font-medium text-fg-muted">
            Share of visitors
          </span>
          <span className="figure text-lg">
            {share !== undefined ? formatPercent(share) : "–"}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b p-5">
        <span className="text-xs font-medium text-fg-secondary">
          Visitors over time
        </span>
        <TrafficChart
          stats={stats.data}
          metric={METRIC.visitors}
          now={stats.dataUpdatedAt}
          compact
        />
      </div>

      <div className="flex flex-col gap-6 p-5">
        {RELATED[KIND[d.dim]]!.map((dim) => (
          <Related
            key={dim}
            dim={dim}
            scope={scope}
            total={stats.data?.summary.visitors}
          />
        ))}
      </div>
    </>
  )
}

function Related({
  dim,
  scope,
  total,
}: {
  dim: Dimension
  scope: Scope
  total?: number
}) {
  const sc = useScope()
  const q = useBreakdown(sc.siteId, { ...scope, compare: undefined }, dim, {
    limit: 6,
  })
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-fg-secondary">
        {DIMS[dim].plural}
      </h3>
      {q.isError ? (
        <ErrorNote queries={[q]} className="py-2" />
      ) : (
        <BarList
          dim={dim}
          rows={q.data}
          loading={q.isPending}
          total={total}
          rowsShown={6}
        />
      )}
    </section>
  )
}
