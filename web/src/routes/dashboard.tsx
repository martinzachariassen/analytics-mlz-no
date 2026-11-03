import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import {
  ArrowRightLeft,
  CalendarDays,
  Globe,
  Monitor,
  Settings,
  Smartphone,
  Tablet,
} from "lucide-react"

import { BreakdownCard, type BreakdownTab } from "@/components/breakdown-card"
import { EventsCard } from "@/components/events-card"
import { Insights } from "@/components/insights"
import { KpiCards } from "@/components/kpi-cards"
import { VisitorsChart } from "@/components/visitors-chart"
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

const withIcon = (Icon: typeof Globe) => (v: string) => (
  <>
    <Icon className="size-4 shrink-0 text-muted-foreground" />
    <span className="truncate">{v}</span>
  </>
)

const DEVICE_ICONS: Record<string, typeof Globe> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
}

const PAGES: BreakdownTab[] = [
  { dim: "path", label: "Top pages", countLabel: "Views" },
  { dim: "entry", label: "Landing pages", countLabel: "Visits" },
]
const SOURCES: BreakdownTab[] = [
  {
    dim: "referrer",
    label: "Websites",
    countLabel: "Visits",
    // No favicons: fetching them would tell a third party which sites link here.
    render: withIcon(Globe),
    empty: withIcon(ArrowRightLeft)("Direct / bookmark"),
  },
  { dim: "utm_source", label: "Campaign source", countLabel: "Visits" },
  { dim: "utm_medium", label: "Medium", countLabel: "Visits" },
  { dim: "utm_campaign", label: "Campaign", countLabel: "Visits" },
]
const LOCATIONS: BreakdownTab[] = [
  {
    dim: "country",
    label: "Countries",
    countLabel: "Visits",
    render: formatCountry,
    empty: "Unknown",
  },
]
const DEVICES: BreakdownTab[] = [
  {
    dim: "device",
    label: "Device",
    countLabel: "Visits",
    render: (v) => withIcon(DEVICE_ICONS[v] ?? Monitor)(capitalize(v)),
    empty: "Unknown",
  },
  { dim: "browser", label: "Browser", countLabel: "Visits", empty: "Unknown" },
  { dim: "os", label: "OS", countLabel: "Visits", empty: "Unknown" },
]

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function DashboardPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const periodParam = params.get("period")
  const period: Period = isPeriod(periodParam) ? periodParam : DEFAULT_PERIOD
  const range = periodRange(period)
  const prevRange = previousRange(range, period)

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
      <p className="text-muted-foreground">
        This site does not exist.{" "}
        <Link to="/sites" className="underline">
          Back to sites
        </Link>
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={id}
              onValueChange={(v) =>
                navigate(`/sites/${v}?${params.toString()}`)
              }
            >
              <SelectTrigger
                aria-label="Site"
                className="h-auto! max-w-72 border-none bg-transparent! px-0 py-0 text-2xl font-semibold tracking-tight shadow-none"
              >
                <SelectValue placeholder="Site">{site?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {sites.data?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    <span className="text-muted-foreground">{s.domain}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Realtime siteId={id} />
          </div>
          <p className="text-sm text-muted-foreground">
            {site?.domain && <>{site.domain} · </>}
            <span className="text-foreground">{formatRange(range)}</span>
            <span className="max-sm:hidden">
              {" "}
              · compared with {formatRange(prevRange)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={period}
            onValueChange={(v) =>
              setParams((p) => {
                p.set("period", v)
                return p
              })
            }
          >
            <SelectTrigger className="w-44 bg-card" aria-label="Period">
              <CalendarDays className="text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {Object.entries(PERIODS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="bg-card"
            asChild
            aria-label="Site settings"
          >
            <Link to={`/sites/${id}/settings`}>
              <Settings />
            </Link>
          </Button>
        </div>
      </div>

      {stats.isError &&
        !(stats.error instanceof ApiError && stats.error.status === 404) && (
          <p className="text-destructive">{stats.error.message}</p>
        )}

      <Insights
        siteId={id}
        range={range}
        stats={stats.data}
        previous={prevSummary}
      />
      <KpiCards summary={stats.data?.summary} previous={prevSummary} />
      <VisitorsChart
        stats={stats.data}
        previous={previous.data}
        now={stats.dataUpdatedAt}
      />

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <BreakdownCard
          title="Pages"
          description="What people read"
          siteId={id}
          range={range}
          tabs={PAGES}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Sources"
          description="Where visitors came from"
          siteId={id}
          range={range}
          tabs={SOURCES}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Locations"
          description="Country, based on IP (the IP itself is never stored)"
          siteId={id}
          range={range}
          tabs={LOCATIONS}
          totalVisitors={visitors}
        />
        <BreakdownCard
          title="Devices"
          description="What visitors use to browse"
          siteId={id}
          range={range}
          tabs={DEVICES}
          totalVisitors={visitors}
        />
      </div>

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
        <span className="flex shrink-0 items-center gap-2 rounded-full border bg-card px-2.5 py-1 text-xs font-medium">
          <span className="relative flex size-2">
            {n > 0 && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            )}
            <span
              className={`relative inline-flex size-2 rounded-full ${n > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            />
          </span>
          {n} online now
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Visitors active in the last 5 minutes. Updates every 15 seconds.
      </TooltipContent>
    </Tooltip>
  )
}
