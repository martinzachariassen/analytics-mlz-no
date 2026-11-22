import { Suspense, useCallback, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router"

import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { ErrorNote } from "@/components/error-note"
import { PageHeader } from "@/components/page-header"
import { ShortcutsDialog, useShortcutsKey } from "@/components/shortcuts-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { useMe } from "@/lib/queries"

/**
 * Authenticated shell: a collapsible sidebar (sites and views) next to the
 * page. Sends visitors without a session to the home page.
 */
export function AppLayout() {
  const location = useLocation()
  const me = useMe()
  const [search, setSearch] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const openShortcuts = useCallback(() => setShortcuts(true), [])
  useShortcutsKey(openShortcuts)

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
  // A failed background re-check (window focus) keeps the signed-in user: only a first load
  // that failed replaces the app with an error.
  if (!me.data) {
    return (
      <ErrorNote
        queries={[me]}
        title="Could not reach the server"
        className="p-6"
      />
    )
  }

  const dev = me.data.provider === "dev"
  return (
    <SidebarProvider>
      <AppSidebar
        user={me.data}
        onSearch={() => setSearch(true)}
        onShortcuts={openShortcuts}
      />
      <SidebarInset className="min-w-0 bg-bg">
        {dev && (
          <div className="border-b py-1 text-center text-[11px] text-fg-muted">
            Local development · demo data, automatic sign-in
          </div>
        )}
        <Suspense
          fallback={
            <>
              <PageHeader title={<span className="sr-only">Loading</span>} />
              <Skeleton className="m-6 h-96" />
            </>
          }
        >
          <Outlet />
        </Suspense>
      </SidebarInset>
      <CommandMenu
        open={search}
        onOpenChange={setSearch}
        onShortcuts={openShortcuts}
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </SidebarProvider>
  )
}
