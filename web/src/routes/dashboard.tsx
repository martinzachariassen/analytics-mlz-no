import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { Settings } from "lucide-react"

import { BreakdownCard, type BreakdownTab } from "@/components/breakdown-card"
import { EventsCard } from "@/components/events-card"
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
  isPeriod,
  PERIODS,
  periodRange,
  type Period,
} from "@/lib/period"

const PAGES: BreakdownTab[] = [
  { dim: "path", label: "Top pages", countLabel: "Views" },
  { dim: "entry", label: "Entry pages", countLabel: "Visits" },
]
const SOURCES: BreakdownTab[] = [
  {
    dim: "referrer",
    label: "Referrers",
    countLabel: "Visits",
    empty: "Direct / none",
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
    empty: "Unknown",
  },
]
const DEVICES: BreakdownTab[] = [
  { dim: "browser", label: "Browser", countLabel: "Visits", empty: "Unknown" },
  { dim: "os", label: "OS", countLabel: "Visits", empty: "Unknown" },
  {
    dim: "device",
    label: "Device",
    countLabel: "Visits",
    render: capitalize,
    empty: "Unknown",
  },
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

  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })
  const stats = useQuery({
    queryKey: ["stats", id, range],
    queryFn: () => api.stats(id, range),
  })
  const site = sites.data?.find((s) => s.id === id)

  if (stats.error instanceof ApiError && stats.error.status === 404) {
    return (
      <p className="text-muted-foreground">
        This site does not exist.{" "}
        <Link to="/" className="underline">
          Back to sites
        </Link>
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Select
            value={id}
            onValueChange={(v) => navigate(`/sites/${v}?${params.toString()}`)}
          >
            <SelectTrigger className="max-w-64 text-base font-semibold">
              <SelectValue placeholder="Site">{site?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sites.data?.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Realtime siteId={id} />
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
            <SelectTrigger className="w-40">
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

      <KpiCards stats={stats.data} />
      <VisitorsChart stats={stats.data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <BreakdownCard title="Pages" siteId={id} range={range} tabs={PAGES} />
        <BreakdownCard
          title="Sources"
          siteId={id}
          range={range}
          tabs={SOURCES}
        />
        <BreakdownCard
          title="Locations"
          siteId={id}
          range={range}
          tabs={LOCATIONS}
        />
        <BreakdownCard
          title="Devices"
          siteId={id}
          range={range}
          tabs={DEVICES}
        />
      </div>

      <EventsCard siteId={id} range={range} />
    </div>
  )
}

function Realtime({ siteId }: { siteId: string }) {
  const rt = useQuery({
    queryKey: ["realtime", siteId],
    queryFn: () => api.realtime(siteId),
    refetchInterval: 30_000,
  })
  const n = rt.data?.visitors ?? 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex size-2">
            {n > 0 && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            )}
            <span
              className={`relative inline-flex size-2 rounded-full ${n > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
            />
          </span>
          {n} current {n === 1 ? "visitor" : "visitors"}
        </span>
      </TooltipTrigger>
      <TooltipContent>Visitors in the last 5 minutes</TooltipContent>
    </Tooltip>
  )
}
