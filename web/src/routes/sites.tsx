import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router"
import { Globe } from "lucide-react"

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
import { formatNumber } from "@/lib/format"
import { periodRange } from "@/lib/period"

export function SitesPage() {
  const sites = useQuery({ queryKey: ["sites"], queryFn: api.sites })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Visitors in the last 7 days
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

  return (
    <Link to={`/sites/${site.id}`} className="group">
      <Card className="h-full transition-colors group-hover:border-foreground/20">
        <CardHeader>
          <CardTitle className="truncate">{site.name}</CardTitle>
          <CardDescription className="truncate">{site.domain}</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.data ? (
            <p className="text-3xl font-semibold tabular-nums">
              {formatNumber(stats.data.summary.visitors)}
            </p>
          ) : (
            <Skeleton className="h-9 w-16" />
          )}
          <p className="text-xs text-muted-foreground">visitors</p>
        </CardContent>
      </Card>
    </Link>
  )
}
