import { lazy, Suspense } from "react"
import { useSearchParams } from "react-router"
import { IntervalSelect } from "@/components/date-range-picker"
import { ErrorNote } from "@/components/error-note"
import { ActiveHours } from "@/components/heatmap"
import { Insights } from "@/components/insights"
import { KpiStrip } from "@/components/kpi-strip"
import { Panel } from "@/components/panel"
import { ProportionStrip } from "@/components/proportion-strip"
import { ReportCard } from "@/components/report-card"
import { LegendItem, TrafficChart } from "@/components/traffic-chart"
import { Skeleton } from "@/components/ui/skeleton"
import { isMetric, METRIC, type MetricKey } from "@/lib/metrics"
import { formatRange } from "@/lib/period"
import { useBreakdown, useStats } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"

const WorldMap = lazy(() =>
  import("@/components/world-map").then((m) => ({ default: m.WorldMap }))
)

/** The overview: headline numbers, the main chart and a dense grid of reports. */
export function OverviewPage() {
  const sc = useScope()
  const [params, setParams] = useSearchParams()
  const m = params.get("metric")
  const metric: MetricKey = isMetric(m) ? m : "visitors"
  const stats = useStats(sc.siteId, sc.scope, sc.interval)
  const total = stats.data?.summary.visitors
  const setMetric = (k: MetricKey) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p)
        if (k === "visitors") q.delete("metric")
        else q.set("metric", k)
        return q
      },
      { preventScrollReset: true }
    )

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <Insights stats={stats.data} />
      {stats.isError && <ErrorNote queries={[stats]} className="py-2" />}
      <KpiStrip
        stats={stats.data}
        metric={metric}
        onMetric={setMetric}
        now={stats.dataUpdatedAt}
      />
      <Panel
        title={METRIC[metric].label}
        description={
          stats.data &&
          `${formatRange(stats.data.period)}${stats.data.compare ? ` vs ${formatRange(stats.data.compare)}` : ""}`
        }
        action={
          <>
            <span className="flex items-center gap-3 pr-1 text-[11px] text-fg-muted max-sm:hidden">
              <LegendItem color="var(--chart-1)" label="Current" />
              {sc.compare && (
                <LegendItem color="var(--chart-2)" label="Comparison" dashed />
              )}
            </span>
            <IntervalSelect sc={sc} />
          </>
        }
        bodyClassName="px-2 pt-3 pb-2 sm:px-3"
      >
        <TrafficChart
          stats={stats.data}
          metric={METRIC[metric]}
          now={stats.dataUpdatedAt}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <ReportCard
          title="Pages"
          className="lg:col-span-6"
          total={total}
          tabs={[
            { dim: "path", label: "Top pages" },
            { dim: "entry", label: "Entry" },
            { dim: "exit", label: "Exit" },
          ]}
        />
        <ReportCard
          title="Sources"
          className="lg:col-span-6"
          total={total}
          tabs={[
            { dim: "referrer", label: "Referrers" },
            { dim: "utm_source", label: "Source" },
            { dim: "utm_medium", label: "Medium" },
            { dim: "utm_campaign", label: "Campaign" },
          ]}
        />
        <MapCard className="lg:col-span-8" total={total} />
        <ReportCard
          title="Countries"
          className="lg:col-span-4"
          total={total}
          rows={10}
          tabs={[{ dim: "country" }]}
        />
        <ActiveHours className="lg:col-span-7" />
        <DevicesCard className="lg:col-span-5" total={total} />
        <ReportCard
          title="Browsers & OS"
          className="lg:col-span-6"
          total={total}
          tabs={[{ dim: "browser" }, { dim: "os", label: "OS" }]}
        />
        <ReportCard
          title="Events"
          className="lg:col-span-6"
          total={total}
          tabs={[{ dim: "event", label: "Custom events" }]}
        />
      </div>
    </div>
  )
}

function MapCard({ className, total }: { className?: string; total?: number }) {
  const sc = useScope()
  const q = useBreakdown(
    sc.siteId,
    { ...sc.scope, compare: undefined },
    "country",
    {
      limit: 250,
    }
  )
  return (
    <Panel
      title="Visitor map"
      description="Country from IP; the IP is never stored"
      className={className}
    >
      <Suspense fallback={<Skeleton className="aspect-2/1" />}>
        {q.data ? (
          <WorldMap
            rows={q.data}
            total={total}
            onSelect={(code) => sc.openDetail({ dim: "country", value: code })}
          />
        ) : (
          <Skeleton className="aspect-2/1" />
        )}
      </Suspense>
    </Panel>
  )
}

function DevicesCard({
  className,
  total,
}: {
  className?: string
  total?: number
}) {
  const sc = useScope()
  const q = useBreakdown(sc.siteId, sc.scope, "device", { limit: 8 })
  return (
    <ReportCard
      title="Devices"
      className={className}
      total={total}
      tabs={[{ dim: "device" }]}
    >
      {() => <ProportionStrip dim="device" rows={q.data} />}
    </ReportCard>
  )
}
