import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A flat section of the dashboard: hairline border, 4px corners, a small
 * uppercase title. Inside a PanelGrid the borders are shared, like a data sheet.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-lg border bg-surface",
        className
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            {title && <h2 className="eyebrow text-fg-secondary">{title}</h2>}
            {description && (
              <p className="text-xs text-fg-muted">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex flex-1 flex-col p-4 sm:p-5", bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

/** Panels sharing their borders: the grid gap is a 1px line of --border. */
export function PanelGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden rounded-lg border bg-border [&>*]:min-w-0 [&>*]:rounded-none [&>*]:border-0",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Text tabs: uppercase labels, the active one underlined in accent-deep. */
export function TextTabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string }[]
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="-mb-px flex gap-4 overflow-x-auto"
    >
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "eyebrow shrink-0 border-b-2 pb-1.5 tracking-[0.14em] whitespace-nowrap transition-colors",
              active
                ? "border-accent-deep text-fg"
                : "border-transparent hover:text-fg"
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
