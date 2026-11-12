import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { BarList } from "@/components/bar-list"
import { ErrorNote } from "@/components/error-note"
import { Panel } from "@/components/panel"
import { AXIS_TICK, TipBox, TipRow } from "@/components/traffic-chart"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type BreakdownRow, type FilterDim } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useScope } from "@/lib/use-scope"

/** What is happening right now: live visitors and the last 30 minutes. */
export function RealtimePage() {
  const sc = useScope()
  const rt = useQuery({
    queryKey: ["realtime", sc.siteId, "detail"],
    queryFn: () => api.realtime(sc.siteId, true),
    refetchInterval: 10_000,
  })
  const d = rt.data
  const minutes = d?.minutes ?? []
  const pageviews = minutes.reduce((n, m) => n + m.pageviews, 0)
  const data = minutes.map((m) => ({ time: new Date(m.t).getTime(), ...m }))

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      {rt.isError && <ErrorNote queries={[rt]} />}
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <Stat
          label="Visitors now"
          hint="Active in the last 5 minutes"
          value={d ? formatNumber(d.visitors) : undefined}
          live
        />
        <Stat
          label="Page views"
          hint="Last 30 minutes"
          value={d ? formatNumber(pageviews) : undefined}
        />
        <Stat
          label="Top page"
          hint="Last 30 minutes"
          value={d ? (d.pages?.[0]?.value ?? "–") : undefined}
          mono
        />
      </div>

      <Panel
        title="Last 30 minutes"
        description="Page views per minute · updates every 10 seconds"
        bodyClassName="px-2 pt-3 pb-2 sm:px-3"
      >
        {!d ? (
          <Skeleton className="h-56" />
        ) : (
          <ChartContainer
            config={{
              pageviews: { label: "Page views", color: "var(--chart-1)" },
            }}
            className="aspect-auto h-56 w-full"
          >
            <BarChart
              data={data}
              margin={{ left: 0, right: 8, top: 8 }}
              barCategoryGap={2}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={40}
                tick={AXIS_TICK}
                tickFormatter={(t: number) => format(t, "HH:mm")}
              />
              <YAxis
                width={36}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tick={AXIS_TICK}
              />
              <ChartTooltip
                cursor={{ fill: "var(--ui-accent)" }}
                content={({ active, payload }) => {
                  const pt = payload?.[0]?.payload as
                    | (typeof data)[number]
                    | undefined
                  if (!active || !pt) return null
                  return (
                    <TipBox>
                      <p className="font-medium text-fg">
                        {format(pt.time, "HH:mm")}
                      </p>
                      <TipRow
                        color="var(--chart-1)"
                        label="Page views"
                        value={formatNumber(pt.pageviews)}
                      />
                      <TipRow
                        color="var(--fg-muted)"
                        label="Visitors"
                        value={formatNumber(pt.visitors)}
                      />
                    </TipBox>
                  )
                }}
              />
              <Bar
                dataKey="pageviews"
                fill="var(--color-pageviews)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-3 lg:gap-4">
        <LiveList title="Pages" dim="path" rows={d?.pages} error={rt.error} />
        <LiveList
          title="Referrers"
          dim="referrer"
          rows={d?.referrers}
          error={rt.error}
        />
        <LiveList
          title="Countries"
          dim="country"
          rows={d?.countries}
          error={rt.error}
        />
      </div>
    </div>
  )
}

function Stat({
  label,
  hint,
  value,
  live,
  mono,
}: {
  label: string
  hint: string
  value?: string
  live?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-surface px-5 py-4">
      <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        {live && (
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-positive" />
          </span>
        )}
        {label}
      </span>
      {value === undefined ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <span
          className={
            mono
              ? "truncate font-mono text-lg font-medium"
              : "figure text-[36px]"
          }
          title={value}
        >
          {value}
        </span>
      )}
      <span className="text-[11px] text-fg-muted">{hint}</span>
    </div>
  )
}

function LiveList({
  title,
  dim,
  rows,
  error,
}: {
  title: string
  dim: FilterDim
  rows?: BreakdownRow[]
  error?: unknown
}) {
  const sc = useScope()
  const total = rows?.reduce((n, r) => n + r.visitors, 0)
  if (error && !rows) {
    return (
      <Panel title={title} description="Last 30 minutes">
        {/* No retry here: the page-level note above retries the same query. */}
        <ErrorNote error={error} className="py-2" />
      </Panel>
    )
  }
  return (
    <Panel title={title} description="Last 30 minutes">
      <BarList
        dim={dim}
        rows={rows}
        loading={!rows}
        total={total}
        rowsShown={10}
        onOpen={(r) => sc.openDetail({ dim, value: r.value })}
      />
    </Panel>
  )
}
