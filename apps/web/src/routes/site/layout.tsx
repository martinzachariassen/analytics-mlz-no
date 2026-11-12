import { ChevronRight } from "lucide-react"
import { useEffect, useRef } from "react"
import { Link, Outlet, useLocation } from "react-router"
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

/**
 * Everything under /sites/:id: the top bar with the period, comparison and
 * filters (shared by all views through the URL), the view, and the detail
 * sheet.
 */
export function SiteLayout() {
  const sc = useScope()
  const { pathname } = useLocation()
  const site = useSite(sc.siteId)
  useFirstEventToast(site.data?.first_event_at)
  const sub = pathname.slice(`/sites/${sc.siteId}`.length).replace(/^\//, "")
  const settings = sub === "settings"
  const view = VIEWS.find((v) => v.path === sub)

  if (site.error instanceof ApiError && site.error.status === 404) {
    return (
      <div className="flex flex-col items-start gap-3 p-8">
        <p className="display text-2xl">No such site</p>
        <Link to="/sites" className="text-sm text-accent-deep underline">
          ← Back to sites
        </Link>
      </div>
    )
  }

  const title = (
    <span className="flex items-center gap-1.5">
      <span className="truncate text-fg-muted max-sm:hidden">
        {site.data?.name ?? " "}
      </span>
      <ChevronRight className="size-3.5 shrink-0 text-fg-muted max-sm:hidden" />
      <span className="truncate">
        {settings ? "Settings" : (view?.label ?? "Overview")}
      </span>
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
          <WaitingForData site={site.data} />
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
              <span className="max-md:hidden">
                <CompareSelect sc={sc} />
              </span>
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
      <DetailSheet />
    </>
  )
}

/** Says so when a site that was waiting receives its first event. */
function useFirstEventToast(firstEventAt: string | null | undefined) {
  const previous = useRef(firstEventAt)
  useEffect(() => {
    if (previous.current === null && firstEventAt)
      toast.success("First event received")
    previous.current = firstEventAt
  }, [firstEventAt])
}

function Shortcuts() {
  useScopeShortcuts(useScope())
  return null
}
