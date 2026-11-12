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
import { useDebounced } from "@/lib/use-debounced"
import { MAX_FILTERS, useScope } from "@/lib/use-scope"

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
const SEARCH_DEBOUNCE_MS = 250

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
  const [search, setSearch] = useState("")
  const needle = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS)

  const stats = useStats(sc.siteId, sc.scope, sc.interval)
  const rows = useBreakdown(sc.siteId, sc.scope, dim, {
    limit,
    metrics: "full",
  })
  // The table searches the rows it has. When the server has more than were loaded, a
  // search also asks the server with a "contains" filter, so values past the first page are
  // found too. Not for formatted values (countries), whose labels the server does not know.
  const truncated = rows.data?.length === limit
  const serverSearch =
    truncated && !DIMS[dim].format && sc.filters.length < MAX_FILTERS
  const found = useBreakdown(
    sc.siteId,
    {
      ...sc.scope,
      filters: [...sc.filters, { dim, op: "contains", value: needle }],
    },
    dim,
    { limit: PAGE, metrics: "full" },
    serverSearch && needle !== ""
  )
  const searching = serverSearch && needle !== ""
  const table = searching ? found : rows
  // While the server search catches up with what was typed, an empty list is not final.
  const pending =
    serverSearch &&
    (search.trim() !== needle || (searching && found.isPlaceholderData))

  const total = stats.data?.summary.visitors
  const setTab = (d: FilterDim) => {
    setLimit(PAGE)
    setSearch("")
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
      <ErrorNote queries={[stats, rows, found]} />
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
        {table.isError ? (
          <Unavailable className="h-40" />
        ) : (
          <DataTable
            dim={dim}
            rows={table.data}
            loading={table.isPending}
            searching={pending}
            total={total}
            onOpen={(r) => sc.openDetail({ dim, value: r.value })}
            canLoadMore={!searching && truncated && limit < 1000}
            onLoadMore={() => setLimit(1000)}
            search={search}
            onSearch={setSearch}
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
  const [params, setParams] = useSearchParams()
  const picked = params.get("event")
  // A picked event that is not in this period's list falls back to the top one.
  const event =
    picked !== null && events.data?.some((e) => e.value === picked)
      ? picked
      : events.data?.[0]?.value
  const setPicked = (value: string) =>
    setParams(
      (p) => {
        const q = new URLSearchParams(p)
        q.set("event", value)
        q.delete("prop")
        return q
      },
      { preventScrollReset: true }
    )

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
  const [params, setParams] = useSearchParams()
  const picked = params.get("prop")
  const key =
    picked !== null && keys.data?.some((k) => k.value === picked)
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
            <Select
              value={key}
              onValueChange={(v) =>
                setParams(
                  (p) => {
                    const q = new URLSearchParams(p)
                    q.set("prop", v)
                    return q
                  },
                  { preventScrollReset: true }
                )
              }
            >
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
