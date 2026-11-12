import { useQuery } from "@tanstack/react-query"
import { Suspense, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { ErrorNote } from "@/components/error-note"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, api } from "@/lib/api"

/**
 * Authenticated shell: a collapsible sidebar (sites and views) next to the
 * page. Sends visitors without a session to the home page.
 */
export function AppLayout() {
  const location = useLocation()
  const me = useQuery({ queryKey: ["me"], queryFn: api.me })
  const [search, setSearch] = useState(false)

  if (me.isPending) {
    return (
      <div className="flex min-h-svh">
        <div className="w-64 border-r max-md:hidden" />
        <div className="flex-1 p-6">
          <Skeleton className="h-6 w-32" />
        </div>
      </div>
    )
  }
  if (me.error instanceof ApiError && me.error.status === 401) {
    // Keep ?auth_error=… from a failed OAuth callback so the home page can show it.
    return <Navigate to={`/${location.search}`} replace />
  }
  if (me.isError) {
    return (
      <ErrorNote
        error={me.error}
        onRetry={me.refetch}
        retrying={me.isFetching}
        className="p-6"
      />
    )
  }

  const dev = me.data.provider === "dev"
  return (
    <SidebarProvider>
      <AppSidebar user={me.data} onSearch={() => setSearch(true)} />
      <SidebarInset className="min-w-0 bg-bg">
        {dev && (
          <div className="border-b py-1 text-center text-[11px] text-fg-muted">
            Local development · demo data, automatic sign-in
          </div>
        )}
        <Suspense fallback={<Skeleton className="m-6 h-96" />}>
          <Outlet />
        </Suspense>
      </SidebarInset>
      <CommandMenu open={search} onOpenChange={setSearch} />
    </SidebarProvider>
  )
}
