import type { ReactNode } from "react"

import { useScrollFade } from "@/hooks/use-scroll-fade"
import { cn } from "@/lib/utils"

/**
 * A card on the dashboard: hairline border, title row with optional tabs and
 * actions, and a body.
 */
export function Panel({
  title,
  description,
  action,
  tabs,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Rendered under the title row, flush with the body. */
  tabs?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-surface",
        className
      )}
    >
      {(title || action || tabs) && (
        <header className="flex flex-col gap-2 border-b px-4 pt-3">
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-col gap-x-2 sm:flex-row sm:items-baseline">
              {title && (
                <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-fg">
                  {title}
                </h2>
              )}
              {description && (
                <p className="truncate text-xs text-fg-muted max-sm:text-[11px]">
                  {description}
                </p>
              )}
            </div>
            {action && (
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
                {action}
              </div>
            )}
          </div>
          {tabs ?? <div className="h-1" />}
        </header>
      )}
      <div className={cn("flex flex-1 flex-col p-4", bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

/** Text tabs: the active one underlined in the text colour. */
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
  const fade = useScrollFade<HTMLDivElement>()
  return (
    <div
      ref={fade.ref}
      style={fade.style}
      role="tablist"
      aria-label={label}
      className="-mb-px flex [scrollbar-width:none] gap-4 overflow-x-auto"
    >
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={(e) => {
              e.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              })
              onChange(it.value)
            }}
            className={cn(
              "shrink-0 border-b-2 pb-2 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "border-fg text-fg"
                : "border-transparent text-fg-muted hover:text-fg"
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
