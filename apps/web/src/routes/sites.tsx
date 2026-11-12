import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"

import { AddSiteDialog } from "@/components/add-site-dialog"
import { Delta } from "@/components/delta"
import { ErrorNote } from "@/components/error-note"
import { PageHeader } from "@/components/page-header"
import { Sparkline } from "@/components/sparkline"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Site } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { periodRange } from "@/lib/period"

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })
  const count = sites.data?.length

  return (
    <>
      <PageHeader title="All sites" actions={<AddSiteDialog fromUrl />} />
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 p-4 sm:p-6 lg:py-10">
        <header className="flex flex-col gap-1">
          <h2 className="display text-2xl">Sites</h2>
          <p className="text-fg-muted">
            {count === undefined
              ? "\u00a0"
              : `${count} ${count === 1 ? "site" : "sites"} · last 7 days`}
          </p>
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
        {sites.isError && <ErrorNote queries={[sites]} />}
        {count === 0 && (
          <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-14 sm:px-10">
            <p className="display text-2xl">No sites yet</p>
            <p className="max-w-[48ch] text-fg-secondary">
              Add your first website to get a tracking snippet. Numbers show up
              within seconds of the first visit.
            </p>
            <AddSiteDialog />
          </div>
        )}
        {sites.data && sites.data.length > 0 && (
          <div className="flex flex-col">
            <div className="eyebrow hidden grid-cols-[1fr_10rem_7rem_5rem] gap-6 px-5 pb-2 sm:grid">
              <span>Site</span>
              <span>Trend</span>
              <span className="text-right">Visitors</span>
              <span className="text-right">Change</span>
            </div>
            <ul className="flex flex-col gap-2">
              {sites.data.map((s, i) => (
                <SiteRow key={s.id} site={s} index={i} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
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
          <span className="truncate text-[15px] font-semibold">
            {site.name}
          </span>
          <span className="truncate text-xs text-fg-muted">{site.domain}</span>
        </span>
        <span className="max-sm:order-last max-sm:col-span-2">
          {stats.data ? (
            <Sparkline values={stats.data.timeseries.map((b) => b.visitors)} />
          ) : stats.isError ? (
            <span
              className="text-xs text-destructive"
              title={stats.error.message}
            >
              Could not load
            </span>
          ) : (
            <Skeleton className="h-9 w-full" />
          )}
        </span>
        <span className="figure text-right text-[22px]">
          {stats.data ? (
            formatNumber(stats.data.summary.visitors)
          ) : stats.isError ? (
            <span className="text-fg-muted">–</span>
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
