import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { ArrowRight, Globe } from "lucide-react"

import { AddSiteDialog } from "@/components/add-site-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Site } from "@/lib/api"
import { change, formatNumber, formatSignedPercent } from "@/lib/format"
import { periodRange } from "@/lib/period"

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Your websites and how they are doing this week
          </p>
        </div>
        <AddSiteDialog />
      </div>

      {sites.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {sites.isError && (
        <p className="text-destructive">{sites.error.message}</p>
      )}
      {sites.data?.length === 0 && (
        <Card className="items-center py-12 text-center">
          <Globe className="size-10 text-muted-foreground" />
          <CardHeader className="w-full">
            <CardTitle>No sites yet</CardTitle>
            <CardDescription>
              Add your first website to get a tracking snippet.
            </CardDescription>
          </CardHeader>
          <AddSiteDialog />
        </Card>
      )}
      {sites.data && sites.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.data.map((s) => (
            <SiteCard key={s.id} site={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SiteCard({ site }: { site: Site }) {
  const range = periodRange("7d")
  const stats = useQuery({
    queryKey: ["stats", site.id, range],
    queryFn: () => api.stats(site.id, range),
  })
  const delta = stats.data
    ? change(stats.data.summary.visitors, stats.data.previous.visitors)
    : null

  return (
    <Link to={`/sites/${site.id}`} className="group">
      <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{site.name}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </CardTitle>
          <CardDescription className="truncate">{site.domain}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end justify-between gap-4">
          <div>
            {stats.data ? (
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {formatNumber(stats.data.summary.visitors)}
              </p>
            ) : (
              <Skeleton className="h-9 w-16" />
            )}
            <p className="text-xs text-muted-foreground">
              visitors, last 7 days
              {delta !== null && Math.abs(delta) >= 0.005 && (
                <span
                  className={
                    delta > 0
                      ? "ml-1.5 font-medium text-emerald-700 dark:text-emerald-400"
                      : "ml-1.5 font-medium text-rose-700 dark:text-rose-400"
                  }
                >
                  {formatSignedPercent(delta)}
                </span>
              )}
            </p>
          </div>
          {stats.data && (
            <Sparkline values={stats.data.timeseries.map((b) => b.visitors)} />
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

/** A tiny trend line; no axes, the number beside it carries the meaning. */
function Sparkline({ values }: { values: number[] }) {
  const w = 96
  const h = 36
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const pts = values.map(
    (v, i) =>
      [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 4)] as const
  )
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0 overflow-visible text-chart-1"
      aria-hidden
    >
      <polygon
        points={`0,${h} ${line} ${w},${h}`}
        fill="currentColor"
        opacity={0.12}
      />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
