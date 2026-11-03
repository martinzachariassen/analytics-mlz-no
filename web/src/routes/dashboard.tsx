import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { Settings } from "lucide-react"

import { BreakdownCard, type BreakdownTab } from "@/components/breakdown-card"
import { EventsCard } from "@/components/events-card"
import { Insights } from "@/components/insights"
import { Overview, type Series } from "@/components/overview"
import { PanelGrid } from "@/components/panel"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api, ApiError } from "@/lib/api"
import { formatCountry } from "@/lib/format"
import {
  DEFAULT_PERIOD,
  formatRange,
  isPeriod,
  PERIODS,
  periodRange,
  previousRange,
  type Period,
} from "@/lib/period"
import { cn } from "@/lib/utils"

const PAGES: BreakdownTab[] = [
  { dim: "path", label: "Top pages", countLabel: "Views" },
  { dim: "entry", label: "Landing", countLabel: "Visits" },
]
const SOURCES: BreakdownTab[] = [
  {
    dim: "referrer",
    label: "Websites",
    countLabel: "Visits",
    // No favicons: fetching them would tell a third party which sites link here.
    empty: <span className="text-fg-secondary">Direct / bookmark</span>,
  },
  { dim: "utm_source", label: "Source", countLabel: "Visits" },
  { dim: "utm_medium", label: "Medium", countLabel: "Visits" },
  { dim: "utm_campaign", label: "Campaign", countLabel: "Visits" },
]
const LOCATIONS: BreakdownTab[] = [
  {
    dim: "country",
    label: "Countries",
    countLabel: "Visits",
    render: formatCountry,
    text: formatCountry,
    empty: "Unknown",
  },
]
const DEVICES: BreakdownTab[] = [
  {
    dim: "device",
    label: "Device",
    countLabel: "Visits",
    render: capitalize,
    text: capitalize,
    empty: "Unknown",
    strip: true,
  },
  { dim: "browser", label: "Browser", countLabel: "Visits", empty: "Unknown" },
  { dim: "os", label: "OS", countLabel: "Visits", empty: "Unknown" },
]

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The periods with a button of their own; the rest are under "More". */
const QUICK: { value: Period; label: string; key: string }[] = [
  { value: "today", label: "Today", key: "t" },
  { value: "7d", label: "7D", key: "7" },
  { value: "30d", label: "30D", key: "3" },
  { value: "month", label: "MTD", key: "m" },
  { value: "12m", label: "12M", key: "a" },
]
const MORE: { value: Period; key: string }[] = [
  { value: "yesterday", key: "y" },
  { value: "last_month", key: "l" },
]
const SHORTCUTS: Record<string, Period> = Object.fromEntries(
  [...QUICK, ...MORE].map((p) => [p.key, p.value])
)

/** Single-key period shortcuts (t, y, 7, 3, m, l, a), ignored while typing. */
function usePeriodShortcuts(onPeriod: (p: Period) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t.closest("input, textarea, select, [role=dialog]"))
      )
        return
      const p = SHORTCUTS[e.key.toLowerCase()]
      if (p) onPeriod(p)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onPeriod])
}

export function DashboardPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [series, setSeries] = useState<Series>("visitors")
  const periodParam = params.get("period")
  const period: Period = isPeriod(periodParam) ? periodParam : DEFAULT_PERIOD
  const range = periodRange(period)
  const prevRange = previousRange(range, period)

  const setPeriod = (v: Period) =>
    setParams((p) => {
      p.set("period", v)
      return p
    })
  usePeriodShortcuts(setPeriod)

  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })
  const stats = useQuery({
    queryKey: ["stats", id, range],
    queryFn: () => api.stats(id, range),
  })
  const previous = useQuery({
    queryKey: ["stats", id, prevRange],
    queryFn: () => api.stats(id, prevRange),
  })
  const site = sites.data?.find((s) => s.id === id)
  const visitors = stats.data?.summary.visitors
  // Compare with the same range the chart's dashed line shows.
  const prevSummary = previous.data?.summary

  if (stats.error instanceof ApiError && stats.error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-3 py-16">
        <p className="display text-4xl">No such site</p>
        <Link to="/sites" className="text-sm text-accent-deep underline">
          ← Back to sites
        </Link>
      </div>
    )
  }

  const isQuick = QUICK.some((q) => q.value === period)

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-3">
            <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tracking-[0.06em] normal-case">
                {site?.domain ?? "\u00a0"}
              </span>
              <span className="text-accent-deep" aria-hidden>
                /
              </span>
              <Realtime siteId={id} />
            </p>
            <div className="flex items-center justify-between gap-3">
              <Select
                value={id}
                onValueChange={(v) =>
                  navigate(`/sites/${v}?${params.toString()}`)
                }
              >
                <SelectTrigger
                  aria-label="Site"
                  className="display h-auto! max-w-full gap-3 border-none bg-transparent! p-0 text-[44px] leading-none shadow-none sm:text-[60px] [&>svg]:size-6! [&>svg]:text-fg-muted"
                >
                  <SelectValue placeholder="Site">{site?.name}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sites.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      <span className="text-fg-muted">{s.domain}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SettingsButton id={id} className="sm:hidden" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Period"
                value={isQuick ? period : undefined}
                onChange={setPeriod}
                items={QUICK.map((q) => ({
                  value: q.value,
                  label: q.label,
                  title: `${PERIODS[q.value]} (${q.key.toUpperCase()})`,
                }))}
              />
              <Select
                value={isQuick ? "" : period}
                onValueChange={(v) => setPeriod(v as Period)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="More periods"
                  className={cn(
                    "h-8! rounded-lg border-[1.5px] text-[11px] tracking-[0.14em] uppercase",
                    isQuick
                      ? "border-fg/30 text-fg-secondary"
                      : "border-fg bg-fg! text-bg [&>svg]:text-bg!"
                  )}
                >
                  <SelectValue placeholder="More">
                    {isQuick ? "More" : PERIODS[period]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {MORE.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {PERIODS[m.value]}
                      <kbd className="ml-auto text-[10px] text-fg-muted uppercase">
                        {m.key}
                      </kbd>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SettingsButton id={id} className="max-sm:hidden" />
            </div>
            <p className="text-[11px] text-fg-muted">
              <span className="text-fg-secondary">{formatRange(range)}</span>
              <span className="max-sm:hidden">
                {" "}
                vs {formatRange(prevRange)}
              </span>
            </p>
          </div>
        </div>
        <Insights
          siteId={id}
          range={range}
          stats={stats.data}
          previous={prevSummary}
        />
      </header>

      {stats.isError &&
        !(stats.error instanceof ApiError && stats.error.status === 404) && (
          <p className="text-sm text-destructive">{stats.error.message}</p>
        )}

      <Overview
        stats={stats.data}
        previous={previous.data}
        now={stats.dataUpdatedAt}
        series={series}
        onSeriesChange={setSeries}
      />

      <PanelGrid className="lg:grid-cols-2">
        <BreakdownCard
          title="Pages"
          siteId={id}
          range={range}
          tabs={PAGES}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Sources"
          siteId={id}
          range={range}
          tabs={SOURCES}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Locations"
          description="Country from IP. The IP itself is never stored."
          siteId={id}
          range={range}
          tabs={LOCATIONS}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Devices"
          siteId={id}
          range={range}
          tabs={DEVICES}
          totalVisitors={visitors}
        />
      </PanelGrid>

      <EventsCard siteId={id} range={range} totalVisitors={visitors} />
    </div>
  )
}

function Realtime({ siteId }: { siteId: string }) {
  const rt = useQuery({
    queryKey: ["realtime", siteId],
    queryFn: () => api.realtime(siteId),
    refetchInterval: 15_000,
  })
  const n = rt.data?.visitors ?? 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex cursor-default items-center gap-2">
          <span className="relative flex size-2">
            {n > 0 && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-violet opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex size-2 rounded-full",
                n > 0 ? "bg-accent-deep" : "bg-fg-muted/40"
              )}
            />
          </span>
          <span className={n > 0 ? "text-fg" : undefined}>{n} online</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Visitors active in the last 5 minutes. Updates every 15 seconds.
      </TooltipContent>
    </Tooltip>
  )
}

function SettingsButton({ id, className }: { id: string; className?: string }) {
  return (
    <Button
      variant="outline"
      size="icon"
      asChild
      aria-label="Site settings"
      className={className}
    >
      <Link to={`/sites/${id}/settings`}>
        <Settings />
      </Link>
    </Button>
  )
}
