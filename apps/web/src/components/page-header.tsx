import type { ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useIsMobile } from "@/hooks/use-mobile"

/** A page's sticky top bar: sidebar toggle, title, and controls on the right. */
export function PageHeader({
  title,
  actions,
  children,
}: {
  title: ReactNode
  actions?: ReactNode
  /** A second row (filters). */
  children?: ReactNode
}) {
  // On a phone the controls would squeeze the title to a few letters, so they move down
  // next to the filters.
  const mobile = useIsMobile()
  const top = mobile ? undefined : actions
  const below = mobile ? actions : undefined
  return (
    <header className="sticky top-0 z-20 border-b bg-bg/85 backdrop-blur-md">
      <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger className="-ml-1 text-fg-muted" />
        <Separator orientation="vertical" className="mr-1 h-4!" />
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {title}
        </h1>
        {top && <div className="flex shrink-0 items-center gap-1.5">{top}</div>}
      </div>
      {(children || below) && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5 sm:px-4">
          {children && <div className="min-w-0 flex-auto">{children}</div>}
          {below && (
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {below}
            </div>
          )}
        </div>
      )}
    </header>
  )
}
