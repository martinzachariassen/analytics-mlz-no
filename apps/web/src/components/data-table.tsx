import { ArrowDown, ArrowUp, Search } from "lucide-react"
import { useMemo, useState } from "react"

import { Delta } from "@/components/delta"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { BreakdownRow, Dimension } from "@/lib/api"
import { DIMS, formatValue } from "@/lib/dims"
import {
  change,
  formatDuration,
  formatNumber,
  formatPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type SortKey =
  | "value"
  | "visitors"
  | "change"
  | "visits"
  | "count"
  | "bounce_rate"
  | "avg_duration"

type Column = {
  key: SortKey
  label: string
  get: (r: BreakdownRow) => number | string | null
  render: (r: BreakdownRow) => React.ReactNode
  hideBelow?: "sm" | "md" | "lg"
}

/**
 * The full report: every value with visitors, change, visits, page views or
 * events, bounce rate and visit duration. Sortable and searchable; clicking a
 * row opens its detail sheet.
 */
export function DataTable({
  dim,
  rows,
  loading,
  total,
  onOpen,
  canLoadMore,
  onLoadMore,
}: {
  dim: Dimension
  rows?: BreakdownRow[]
  loading?: boolean
  total?: number
  onOpen?: (r: BreakdownRow) => void
  canLoadMore?: boolean
  onLoadMore?: () => void
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "visitors",
    desc: true,
  })
  const [search, setSearch] = useState("")
  const info = DIMS[dim]
  const compare = rows?.some((r) => r.previous_visitors !== undefined)
  const full = rows?.some((r) => r.visits !== undefined)
  // For visit-attributed dimensions count is visits, already a column.
  const countIsVisits = info.countLabel === "Visits"
  const max = Math.max(1, ...(rows ?? []).map((r) => r.visitors))

  const columns: Column[] = [
    {
      key: "visitors",
      label: "Visitors",
      get: (r) => r.visitors,
      render: (r) => (
        <span className="font-medium text-fg">{formatNumber(r.visitors)}</span>
      ),
    },
    ...(compare
      ? [
          {
            key: "change" as const,
            label: "Change",
            get: (r: BreakdownRow) =>
              change(r.visitors, r.previous_visitors ?? 0),
            render: (r: BreakdownRow) => (
              <Delta
                plain
                current={r.visitors}
                previous={r.previous_visitors ?? 0}
              />
            ),
          },
        ]
      : []),
    ...(full
      ? [
          {
            key: "visits" as const,
            label: "Visits",
            get: (r: BreakdownRow) => r.visits ?? 0,
            render: (r: BreakdownRow) => formatNumber(r.visits ?? 0),
            hideBelow: "sm" as const,
          },
        ]
      : []),
    ...(!countIsVisits
      ? [
          {
            key: "count" as const,
            label: info.countLabel,
            get: (r: BreakdownRow) => r.count,
            render: (r: BreakdownRow) => formatNumber(r.count),
            hideBelow: "sm" as const,
          },
        ]
      : []),
    ...(full
      ? [
          {
            key: "bounce_rate" as const,
            label: "Bounce",
            get: (r: BreakdownRow) => r.bounce_rate ?? 0,
            render: (r: BreakdownRow) => formatPercent(r.bounce_rate ?? 0),
            hideBelow: "md" as const,
          },
          {
            key: "avg_duration" as const,
            label: "Duration",
            get: (r: BreakdownRow) => r.avg_duration ?? 0,
            render: (r: BreakdownRow) => formatDuration(r.avg_duration ?? 0),
            hideBelow: "md" as const,
          },
        ]
      : []),
  ]

  // columns is derived from rows and dim, which are already dependencies.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const sorted = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (rows ?? []).filter(
      (r) =>
        !needle ||
        r.value.toLowerCase().includes(needle) ||
        formatValue(dim, r.value).toLowerCase().includes(needle)
    )
    const col = columns.find((c) => c.key === sort.key)
    const get =
      sort.key === "value"
        ? (r: BreakdownRow) => formatValue(dim, r.value).toLowerCase()
        : (col?.get ?? ((r: BreakdownRow) => r.visitors))
    return [...list].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x === y) return b.visitors - a.visitors
      if (x === null) return 1
      if (y === null) return -1
      const cmp = x < y ? -1 : 1
      return sort.desc ? -cmp : cmp
    })
  }, [rows, search, sort, dim])

  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "value" }
    )
  const hide = {
    sm: "max-sm:hidden",
    md: "max-md:hidden",
    lg: "max-lg:hidden",
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="relative w-full max-w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${info.plural.toLowerCase()}…`}
            className="h-7 pl-8 text-xs"
          />
        </div>
        <span className="tnum shrink-0 text-xs text-fg-muted">
          {rows ? `${formatNumber(sorted.length)} rows` : ""}
        </span>
      </div>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-4 text-right">#</TableHead>
            <SortHead
              label={info.label}
              active={sort.key === "value"}
              desc={sort.desc}
              onClick={() => toggle("value")}
              className="w-full"
            />
            {columns.map((c) => (
              <SortHead
                key={c.key}
                label={c.label}
                active={sort.key === c.key}
                desc={sort.desc}
                onClick={() => toggle(c.key)}
                className={cn("text-right", c.hideBelow && hide[c.hideBelow])}
                right
              />
            ))}
            <TableHead className="pr-4 text-right max-sm:hidden">
              Share
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading || !rows
            ? Array.from({ length: 10 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length + 3} className="px-4">
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))
            : sorted.map((r, i) => (
                <TableRow
                  key={r.value}
                  onClick={onOpen ? () => onOpen(r) : undefined}
                  onKeyDown={
                    onOpen
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onOpen(r)
                          }
                        }
                      : undefined
                  }
                  tabIndex={onOpen ? 0 : undefined}
                  role={onOpen ? "button" : undefined}
                  className={cn(
                    "tnum text-xs",
                    onOpen &&
                      "cursor-pointer focus-visible:bg-accent focus-visible:outline-none"
                  )}
                >
                  <TableCell className="pl-4 text-right text-fg-muted">
                    {i + 1}
                  </TableCell>
                  <TableCell className="max-w-0">
                    <div className="relative flex h-6 items-center">
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 rounded-[4px] bg-violet/12"
                        style={{ width: `${(r.visitors / max) * 100}%` }}
                      />
                      <span
                        className={cn(
                          "relative truncate px-2",
                          r.value === "" && "text-fg-muted"
                        )}
                        title={formatValue(dim, r.value)}
                      >
                        {formatValue(dim, r.value)}
                      </span>
                    </div>
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(
                        "text-right text-fg-secondary",
                        c.hideBelow && hide[c.hideBelow]
                      )}
                    >
                      {c.render(r)}
                    </TableCell>
                  ))}
                  <TableCell className="pr-4 text-right text-fg-muted max-sm:hidden">
                    {total ? formatPercent(r.visitors / total) : "–"}
                  </TableCell>
                </TableRow>
              ))}
          {rows && sorted.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length + 3}
                className="py-12 text-center text-xs text-fg-muted"
              >
                {search ? "No matches" : "Nothing in this period"}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {canLoadMore && (
        <div className="flex justify-center border-t p-3">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Show more
          </Button>
        </div>
      )}
    </div>
  )
}

function SortHead({
  label,
  active,
  desc,
  onClick,
  className,
  right,
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
  right?: boolean
}) {
  const Icon = desc ? ArrowDown : ArrowUp
  return (
    <TableHead
      className={cn("whitespace-nowrap", className)}
      aria-sort={active ? (desc ? "descending" : "ascending") : undefined}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-fg",
          right && "flex-row-reverse",
          active && "text-fg"
        )}
      >
        {label}
        <Icon className={cn("size-3", active ? "opacity-100" : "opacity-0")} />
      </button>
    </TableHead>
  )
}
