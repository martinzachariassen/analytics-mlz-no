import { lazy, Suspense, useState } from "react"
import { useSearchParams } from "react-router"

import { BarList } from "@/components/bar-list"
import { DataTable } from "@/components/data-table"
import { IntervalSelect } from "@/components/date-range-picker"
import { ErrorNote, Unavailable } from "@/components/error-note"
import { ExportLink } from "@/components/export-link"
import { GoalButton } from "@/components/goal-button"
import { KpiStrip } from "@/components/kpi-strip"
import { Panel, TextTabs } from "@/components/panel"
import { ProportionStrip } from "@/components/proportion-strip"
import { TopSeriesChart } from "@/components/top-series-chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { exportUrl, type FilterDim } from "@/lib/api"
import { DIMS, formatValue } from "@/lib/dims"
import { useBreakdown, useStats } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"

const WorldMap = lazy(() =>
  import("@/components/world-map").then((m) => ({ default: m.WorldMap }))
)

export type ReportConfig = {
  tabs: { dim: FilterDim; label?: string }[]
  /** Extra panel above the chart. */
  extra?: "map" | "strip"
}

export const REPORTS: Record<string, ReportConfig> = {
  pages: {
    tabs: [
      { dim: "path", label: "All pages" },
      { dim: "entry", label: "Entry pages" },
      { dim: "exit", label: "Exit pages" },
      { dim: "hostname", label: "Hostnames" },
    ],
  },
  sources: {
    tabs: [
      { dim: "referrer", label: "Referrers" },
      { dim: "utm_source", label: "UTM source" },
      { dim: "utm_medium", label: "UTM medium" },
      { dim: "utm_campaign", label: "UTM campaign" },
    ],
  },
  locations: { tabs: [{ dim: "country", label: "Countries" }], extra: "map" },
  devices: {
    tabs: [
      { dim: "device", label: "Device type" },
      { dim: "browser", label: "Browser" },
      { dim: "os", label: "Operating system" },
    ],
    extra: "strip",
  },
}

const PAGE = 100

/**
 * A full report for one area: the KPIs, the top five values over time, and a
 * table with every value and all metrics. Tabs pick the dimension (?tab=).
 */
export function ReportPage({ report }: { report: keyof typeof REPORTS }) {
  const cfg = REPORTS[report]!
  const sc = useScope()
  const [params, setParams] = useSearchParams()
  const t = params.get("tab")
  const dim = cfg.tabs.find((x) => x.dim === t)?.dim ?? cfg.tabs[0]!.dim
  const [limit, setLimit] = useState(PAGE)

  const stats = useStats(sc.siteId, sc.scope, sc.interval)
  const rows = useBreakdown(sc.siteId, sc.scope, dim, {
    limit,
    metrics: "full",
  })
  const total = stats.data?.summary.visitors
  const setTab = (d: FilterDim) => {
    setLimit(PAGE)
    setParams(
      (p) => {
        const q = new URLSearchParams(p)
        q.set("tab", d)
        return q
      },
      { preventScrollReset: true }
    )
  }

  const tabs =
    cfg.tabs.length > 1 ? (
      <TextTabs
        label="Dimension"
        value={dim}
        onChange={setTab}
        items={cfg.tabs.map((x) => ({
          value: x.dim,
          label: x.label ?? DIMS[x.dim].plural,
        }))}
      />
    ) : undefined

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <KpiStrip stats={stats.data} now={stats.dataUpdatedAt} />
      <ErrorNote queries={[stats, rows]} />
      {cfg.extra === "map" && (
        <Panel
          title="Visitor map"
          description="Country from IP; the IP is never stored"
        >
          <Suspense fallback={<Skeleton className="aspect-2/1" />}>
            {rows.isError ? (
              <Unavailable className="aspect-2/1 h-auto" />
            ) : rows.data ? (
              <WorldMap
                rows={rows.data}
                total={total}
                onSelect={(code) =>
                  sc.openDetail({ dim: "country", value: code })
                }
              />
            ) : (
              <Skeleton className="aspect-2/1" />
            )}
          </Suspense>
        </Panel>
      )}
      <Panel
        title={`Top ${DIMS[dim].plural.toLowerCase()} over time`}
        description="Visitors"
        tabs={tabs}
        action={<IntervalSelect sc={sc} />}
      >
        {cfg.extra === "strip" && (
          <ProportionStrip dim={dim} rows={rows.data} max={5} />
        )}
        {rows.isError ? (
          <Unavailable />
        ) : (
          <TopSeriesChart sc={sc} dim={dim} rows={rows.data} />
        )}
      </Panel>
      <Panel
        title={DIMS[dim].plural}
        bodyClassName="p-0"
        action={
          <ExportLink
            href={exportUrl.breakdown(sc.siteId, sc.scope, dim)}
            label={DIMS[dim].plural.toLowerCase()}
          />
        }
      >
        {rows.isError ? (
          <Unavailable className="h-40" />
        ) : (
          <DataTable
            dim={dim}
            rows={rows.data}
            loading={rows.isPending}
            total={total}
            onOpen={(r) => sc.openDetail({ dim, value: r.value })}
            canLoadMore={rows.data?.length === limit && limit < 1000}
            onLoadMore={() => setLimit(1000)}
          />
        )}
      </Panel>
    </div>
  )
}

/** Custom events: the table of events, and for one event its properties. */
export function EventsPage() {
  const sc = useScope()
  const stats = useStats(sc.siteId, sc.scope, sc.interval)
  const events = useBreakdown(sc.siteId, sc.scope, "event", {
    limit: 200,
    metrics: "full",
  })
  const total = stats.data?.summary.visitors
  const [picked, setPicked] = useState<string>()
  const event = picked ?? events.data?.[0]?.value

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <KpiStrip stats={stats.data} now={stats.dataUpdatedAt} />
      <ErrorNote queries={[stats, events]} />
      <Panel
        title="Top events over time"
        description="Visitors who triggered each event"
        action={<IntervalSelect sc={sc} />}
      >
        {events.isError ? (
          <Unavailable />
        ) : (
          <TopSeriesChart sc={sc} dim="event" rows={events.data} />
        )}
      </Panel>
      <div className="grid gap-3 lg:grid-cols-12 lg:gap-4">
        <Panel
          title="Events"
          description="Conversion = share of all visitors"
          className="lg:col-span-7"
          bodyClassName="p-0"
          action={
            <ExportLink
              href={exportUrl.breakdown(sc.siteId, sc.scope, "event")}
              label="events"
            />
          }
        >
          {events.isError ? (
            <Unavailable className="h-40" />
          ) : (
            <DataTable
              dim="event"
              rows={events.data}
              loading={events.isPending}
              total={total}
              onOpen={(r) => setPicked(r.value)}
            />
          )}
        </Panel>
        {event !== undefined && (
          <Properties event={event} className="lg:col-span-5" total={total} />
        )}
      </div>
    </div>
  )
}

function Properties({
  event,
  className,
  total,
}: {
  event: string
  className?: string
  total?: number
}) {
  const sc = useScope()
  const scope = { ...sc.scope, compare: undefined }
  const keys = useBreakdown(sc.siteId, scope, "prop_key", { event, limit: 50 })
  const [picked, setPicked] = useState<string>()
  const key =
    picked && keys.data?.some((k) => k.value === picked)
      ? picked
      : keys.data?.[0]?.value
  const values = useBreakdown(
    sc.siteId,
    scope,
    "prop",
    { event, key, limit: 50 },
    key !== undefined
  )

  return (
    <Panel
      title={formatValue("event", event)}
      description="Properties"
      className={className}
      action={
        <>
          <GoalButton siteId={sc.siteId} kind="event" value={event} />
          {key !== undefined && (
            <ExportLink
              href={exportUrl.breakdown(sc.siteId, scope, "prop", {
                event,
                key,
              })}
              label={`${key} values`}
            />
          )}
          {keys.data && keys.data.length > 0 && (
            <Select value={key} onValueChange={setPicked}>
              <SelectTrigger size="sm" className="w-40" aria-label="Property">
                <SelectValue placeholder="Property" />
              </SelectTrigger>
              <SelectContent align="end">
                {keys.data.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      }
    >
      {keys.isError || values.isError ? (
        <ErrorNote queries={[keys, values]} />
      ) : keys.data && keys.data.length === 0 ? (
        <p className="py-10 text-center text-xs text-fg-muted">
          This event has no properties.
        </p>
      ) : (
        <BarList
          dim="prop"
          rows={values.data}
          loading={keys.isPending || values.isPending}
          total={total}
          rowsShown={50}
          showCount
          countLabel="Events"
        />
      )}
    </Panel>
  )
}
