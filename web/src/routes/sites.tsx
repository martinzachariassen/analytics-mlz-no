import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { AddSiteDialog } from "@/components/add-site-dialog"
import { Delta } from "@/components/delta"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Site } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { periodRange } from "@/lib/period"

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })
  const count = sites.data?.length

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <p className="eyebrow">
            {count === undefined
              ? " "
              : `${count} ${count === 1 ? "site" : "sites"}`}{" "}
            <span className="text-accent-deep">/</span> last 7 days
          </p>
          <h1 className="display text-[44px] sm:text-[60px]">Sites</h1>
        </div>
        <AddSiteDialog />
      </header>

      {sites.isPending && (
        <div className="flex flex-col gap-px overflow-hidden rounded-lg border bg-border">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface p-5">
              <Skeleton className="h-10" />
            </div>
          ))}
        </div>
      )}
      {sites.isError && (
        <p className="text-sm text-destructive">{sites.error.message}</p>
      )}
      {count === 0 && (
        <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-14 sm:px-10">
          <p className="display text-4xl">No sites yet</p>
          <p className="max-w-[48ch] text-fg-secondary">
            Add your first website to get a tracking snippet. Numbers show up
            within seconds of the first visit.
          </p>
          <AddSiteDialog />
        </div>
      )}
      {sites.data && sites.data.length > 0 && (
        <div className="flex flex-col">
          <div className="eyebrow hidden grid-cols-[1fr_10rem_7rem_5rem] gap-6 px-5 pb-2 text-[10px] sm:grid">
            <span>Site</span>
            <span>Trend</span>
            <span className="text-right">Visitors</span>
            <span className="text-right">Change</span>
          </div>
          <ul className="flex flex-col gap-3">
            {sites.data.map((s, i) => (
              <SiteRow key={s.id} site={s} index={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SiteRow({ site, index }: { site: Site; index: number }) {
  const range = periodRange("7d")
  const stats = useQuery({
    queryKey: ["stats", site.id, range],
    queryFn: () => api.stats(site.id, range),
  })

  return (
    <li className="rise" style={{ "--i": index } as React.CSSProperties}>
      <Link
        to={`/sites/${site.id}`}
        className="hover-lift grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 rounded-lg border bg-surface px-5 py-4 sm:grid-cols-[1fr_10rem_7rem_5rem]"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="display truncate text-[28px]">{site.name}</span>
          <span className="truncate text-xs text-fg-muted">{site.domain}</span>
        </span>
        <span className="max-sm:order-last max-sm:col-span-2">
          {stats.data ? (
            <Sparkline values={stats.data.timeseries.map((b) => b.visitors)} />
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </span>
        <span className="figure text-right text-[26px]">
          {stats.data ? (
            formatNumber(stats.data.summary.visitors)
          ) : (
            <Skeleton className="ml-auto h-7 w-14" />
          )}
        </span>
        <span className="text-right max-sm:hidden">
          {stats.data && (
            <Delta
              current={stats.data.summary.visitors}
              previous={stats.data.previous.visitors}
            />
          )}
        </span>
      </Link>
    </li>
  )
}

/** A tiny trend line; no axes, the number beside it carries the meaning. */
function Sparkline({ values }: { values: number[] }) {
  const w = 160
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
      viewBox={`0 0 ${w} ${h}`}
      className="h-9 w-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon
        points={`0,${h} ${line} ${w},${h}`}
        fill="var(--accent)"
        opacity={0.16}
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent-deep)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
