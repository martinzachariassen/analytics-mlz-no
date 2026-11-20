import { ChevronRight } from "lucide-react"
import { useEffect, useRef } from "react"
import { Link, Outlet, useLocation, useSearchParams } from "react-router"
import { toast } from "sonner"

import { VIEWS } from "@/components/app-sidebar"
import {
  CompareSelect,
  DateRangePicker,
  useScopeShortcuts,
} from "@/components/date-range-picker"
import { DetailSheet } from "@/components/detail-sheet"
import { FilterBar } from "@/components/filter-bar"
import { PageHeader } from "@/components/page-header"
import { WaitingForData } from "@/components/waiting-for-data"
import { ApiError } from "@/lib/api"
import { useSite } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"
import { useTitle } from "@/lib/use-title"

/**
 * Everything under /sites/:id: the top bar with the period, comparison and
 * filters (shared by all views through the URL), the view, and the detail
 * sheet.
 */
export function SiteLayout() {
  const sc = useScope()
  const { pathname } = useLocation()
  const site = useSite(sc.siteId)
  const [params, setParams] = useSearchParams()
  useFirstEventToast(sc.siteId, site.data?.first_event_at)
  // "new" only means something while waiting; a later reload should not say "Site added".
  // Replaced, not pushed: Back would land on ?new=1 and be sent forward again.
  const hasData = !!site.data?.first_event_at
  useEffect(() => {
    if (!hasData || !params.has("new")) return
    const next = new URLSearchParams(params)
    next.delete("new")
    setParams(next, { replace: true, preventScrollReset: true })
  }, [hasData, params, setParams])
  const sub = pathname.slice(`/sites/${sc.siteId}`.length).replace(/^\//, "")
  const settings = sub === "settings"
  const view = VIEWS.find((v) => v.path === sub)
  const viewLabel = settings ? "Settings" : (view?.label ?? "Overview")
  useTitle(viewLabel, site.data?.name)

  if (site.error instanceof ApiError && site.error.status === 404) {
    return (
      <>
        <PageHeader title="No such site" />
        <div className="flex flex-col items-start gap-3 p-8">
          <p className="display text-2xl">No such site</p>
          <p className="text-sm text-fg-secondary">
            It may have been deleted, or the link is wrong.
          </p>
          <Link to="/sites" className="text-sm text-accent-deep underline">
            ← Back to sites
          </Link>
        </div>
      </>
    )
  }

  const title = (
    <span className="flex items-center gap-1.5">
      <span className="truncate text-fg-muted max-sm:hidden">
        {site.data?.name ?? " "}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-fg-muted max-sm:hidden" />
      <span className="truncate">{viewLabel}</span>
    </span>
  )

  if (settings)
    return (
      <>
        <PageHeader title={title} />
        <Outlet />
      </>
    )

  if (site.data?.first_event_at === null)
    return (
      <>
        <PageHeader title={title} />
        <div className="p-3 sm:p-4 lg:p-6">
          <WaitingForData site={site.data} isNew={params.has("new")} />
        </div>
      </>
    )

  return (
    <>
      <Shortcuts />
      <PageHeader
        title={title}
        actions={
          sub !== "realtime" && (
            <>
              <CompareSelect sc={sc} />
              <DateRangePicker sc={sc} />
            </>
          )
        }
      >
        {sub !== "realtime" && <FilterBar sc={sc} />}
      </PageHeader>
      <div className="mx-auto w-full max-w-[1400px] p-3 sm:p-4 lg:p-6">
        <Outlet />
      </div>
      {sub === "realtime" ? (
        <DetailSheet
          period="today"
          rangeNote="Today · the Realtime page itself shows the last 30 minutes"
        />
      ) : (
        <DetailSheet />
      )}
    </>
  )
}

/**
 * Says so when the site on screen goes from waiting to having data. Keyed on the site,
 * because the layout stays mounted when the sidebar switches from a waiting site to one
 * whose data is already cached.
 */
function useFirstEventToast(
  siteId: string,
  firstEventAt: string | null | undefined
) {
  const previous = useRef({ siteId, firstEventAt })
  useEffect(() => {
    const p = previous.current
    if (p.siteId === siteId && p.firstEventAt === null && firstEventAt)
      toast.success("First event received")
    previous.current = { siteId, firstEventAt }
  }, [siteId, firstEventAt])
}

function Shortcuts() {
  useScopeShortcuts(useScope())
  return null
}
