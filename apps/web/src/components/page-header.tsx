import type { ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

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
  return (
    <header className="sticky top-0 z-20 border-b bg-bg/85 backdrop-blur-md">
      <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger className="-ml-1 text-fg-muted" />
        <Separator orientation="vertical" className="mr-1 h-4!" />
        <h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {title}
        </h1>
        {actions && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children && <div className="px-3 pb-2.5 sm:px-4">{children}</div>}
    </header>
  )
}
