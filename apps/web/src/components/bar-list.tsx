import { ChevronRight, Filter as FilterIcon } from "lucide-react"
import { Link } from "react-router"

import { Delta } from "@/components/delta"
import { Skeleton } from "@/components/ui/skeleton"
import type { BreakdownRow, Dimension } from "@/lib/api"
import { formatValue, isFilterDim } from "@/lib/dims"
import { formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Ranked values with a bar behind each label (sized by visitors relative to
 * the top row), the visitor count and either the change or the share.
 * Clicking a row opens it; the filter button narrows the dashboard to it.
 */
export function BarList({
  dim,
  rows,
  total,
  loading,
  rowsShown = 8,
  onOpen,
  onFilter,
  selected,
  showCount,
  countLabel,
}: {
  dim: Dimension
  rows?: BreakdownRow[]
  /** Total visitors, for the share column. */
  total?: number
  loading?: boolean
  rowsShown?: number
  onOpen?: (row: BreakdownRow) => void
  onFilter?: (row: BreakdownRow) => void
  selected?: string
  showCount?: boolean
  countLabel?: string
}) {
  if (loading || !rows)
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: Math.min(rowsShown, 6) }, (_, i) => (
          <Skeleton key={i} className="h-7" style={{ opacity: 1 - i * 0.14 }} />
        ))}
      </div>
    )
  if (rows.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-xs text-fg-muted">
        Nothing in this period
      </div>
    )

  const max = rows[0]?.visitors || 1
  const compare = rows.some((r) => r.previous_visitors !== undefined)
  const filterable = onFilter !== undefined && isFilterDim(dim)
  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "mb-1 flex items-center justify-between gap-3 px-2 text-[11px] font-medium text-fg-muted",
          filterable && "pr-10"
        )}
      >
        <span>Name</span>
        <span className="flex gap-4">
          {showCount && <span className="w-14 text-right">{countLabel}</span>}
          <span className="w-14 text-right">Visitors</span>
          <span className="w-14 text-right">
            {compare ? "Change" : "Share"}
          </span>
        </span>
      </div>
      <ul className="flex flex-col gap-px">
        {rows.slice(0, rowsShown).map((r) => {
          const label = formatValue(dim, r.value)
          return (
            <li key={r.value} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={onOpen ? () => onOpen(r) : undefined}
                disabled={!onOpen}
                className={cn(
                  "relative flex h-7 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 text-left text-xs transition-colors",
                  onOpen && "hover:bg-surface-2",
                  selected === r.value && "bg-surface-2"
                )}
                title={label}
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0.5 left-0 rounded-[5px] bg-violet/14 transition-[width] duration-500"
                  style={{ width: `${Math.max((r.visitors / max) * 100, 1)}%` }}
                />
                <span
                  className={cn(
                    "relative min-w-0 truncate",
                    r.value === "" ? "text-fg-muted" : "text-fg"
                  )}
                >
                  {label}
                </span>
                <span className="tnum relative flex shrink-0 gap-4 text-fg-secondary">
                  {showCount && (
                    <span className="w-14 text-right">
                      {formatNumber(r.count)}
                    </span>
                  )}
                  <span className="w-14 text-right font-medium text-fg">
                    {formatNumber(r.visitors)}
                  </span>
                  <span className="w-14 text-right">
                    {compare ? (
                      <Delta
                        plain
                        current={r.visitors}
                        previous={r.previous_visitors ?? 0}
                      />
                    ) : total ? (
                      formatPercent(r.visitors / total)
                    ) : (
                      "–"
                    )}
                  </span>
                </span>
              </button>
              {filterable && (
                <button
                  type="button"
                  aria-label={`Filter by ${label}`}
                  title="Filter by this"
                  onClick={() => onFilter(r)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted transition-opacity hover:bg-surface-2 hover:text-fg focus-visible:opacity-100 md:opacity-40 md:group-focus-within:opacity-100 md:group-hover:opacity-100 pointer-coarse:opacity-100"
                >
                  <FilterIcon className="size-3" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ViewAll({ to, label }: { to: string; label?: string }) {
  return (
    <Link
      to={to}
      className="mt-auto flex items-center gap-1 self-end pt-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
    >
      {label ?? "View all"}
      <ChevronRight className="size-3" />
    </Link>
  )
}
