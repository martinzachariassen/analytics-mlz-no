import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { Panel, TextTabs } from "@/components/panel"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  api,
  type BreakdownRow,
  type Dimension,
  type RangeParams,
} from "@/lib/api"
import { formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

export type BreakdownTab = {
  dim: Dimension
  label: string
  /** Column header for the count, e.g. "Views" or "Visits". */
  countLabel: string
  /** Renders a value; empty values usually mean "none". */
  render?: (value: string) => ReactNode
  /** Plain text for a value, for search in the details dialog. */
  text?: (value: string) => string
  empty?: ReactNode
  /** Few values (devices): show a proportion strip above the list. */
  strip?: boolean
}

export const PAGE = 10
const MORE = 100

/** A panel with tabs, each showing the top values of a dimension as proportional bars. */
export function BreakdownCard({
  title,
  description,
  siteId,
  range,
  tabs,
  totalVisitors,
}: {
  title: string
  description?: string
  siteId: string
  range: RangeParams
  tabs: BreakdownTab[]
  /** Visitors in the whole period, for the share column. */
  totalVisitors?: number
}) {
  const [active, setActive] = useState(tabs[0]!.dim)
  const [open, setOpen] = useState(false)
  const tab = tabs.find((t) => t.dim === active) ?? tabs[0]!

  const rows = useQuery({
    queryKey: ["breakdown", siteId, range, tab.dim, PAGE],
    queryFn: () => api.breakdown(siteId, range, tab.dim, { limit: PAGE }),
  })
  const hasMore = rows.data?.length === PAGE

  return (
    <Panel
      title={title}
      description={description}
      action={
        tabs.length > 1 ? (
          <TextTabs
            label={title}
            value={active}
            onChange={setActive}
            items={tabs.map((t) => ({ value: t.dim, label: t.label }))}
          />
        ) : undefined
      }
      bodyClassName="gap-3"
    >
      {tab.strip && rows.data && rows.data.length > 0 && (
        <ProportionStrip rows={rows.data} tab={tab} />
      )}
      <BarList
        rows={rows.data}
        tab={tab}
        loading={rows.isPending}
        total={totalVisitors}
      />
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="eyebrow mt-auto self-start pt-2 tracking-[0.14em] text-fg-secondary transition-colors hover:text-accent-deep"
        >
          All {tab.label.toLowerCase()} →
        </button>
      )}
      {open && (
        <BreakdownDialog
          open={open}
          onOpenChange={setOpen}
          title={`${title} · ${tab.label}`}
          siteId={siteId}
          range={range}
          tab={tab}
          total={totalVisitors}
        />
      )}
    </Panel>
  )
}

/** The full list (up to 100) with search and sorting, like Plausible's details view. */
function BreakdownDialog({
  open,
  onOpenChange,
  title,
  siteId,
  range,
  tab,
  total,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  siteId: string
  range: RangeParams
  tab: BreakdownTab
  total?: number
}) {
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<"visitors" | "count">("visitors")
  const rows = useQuery({
    queryKey: ["breakdown", siteId, range, tab.dim, MORE],
    queryFn: () => api.breakdown(siteId, range, tab.dim, { limit: MORE }),
  })
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = (rows.data ?? []).filter(
      (r) =>
        !needle ||
        (tab.text?.(r.value) ?? r.value).toLowerCase().includes(needle)
    )
    return [...list].sort((a, b) => b[sort] - a[sort])
  }, [rows.data, q, sort, tab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="display text-3xl">{title}</DialogTitle>
          <DialogDescription>
            Top {MORE} for this period. Sorted by{" "}
            {sort === "visitors" ? "visitors" : tab.countLabel.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 flex-1"
          />
          <div className="flex gap-3">
            {(["visitors", "count"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                aria-pressed={sort === s}
                className={cn(
                  "eyebrow border-b-2 pb-1 tracking-[0.14em]",
                  sort === s
                    ? "border-accent-deep text-fg"
                    : "border-transparent hover:text-fg"
                )}
              >
                {s === "visitors" ? "Visitors" : tab.countLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          <BarList
            rows={shown}
            tab={tab}
            loading={rows.isPending}
            total={total}
            showCount
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A 100% strip for dimensions with only a few values (devices). */
function ProportionStrip({
  rows,
  tab,
}: {
  rows: BreakdownRow[]
  tab: BreakdownTab
}) {
  const sum = rows.reduce((n, r) => n + r.visitors, 0) || 1
  // One hue, stepped: identity is carried by the labels below, not colour alone.
  const shades = [
    "var(--accent-deep)",
    "color-mix(in oklch, var(--accent-deep) 55%, var(--surface))",
    "color-mix(in oklch, var(--accent-deep) 25%, var(--surface))",
    "var(--border)",
  ]
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-sm"
        aria-hidden
      >
        {rows.slice(0, 4).map((r, i) => (
          <span
            key={r.value}
            style={{
              width: `${(r.visitors / sum) * 100}%`,
              background: shades[i],
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-muted">
        {rows.slice(0, 4).map((r, i) => (
          <span key={r.value} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-[1px]"
              style={{ background: shades[i] }}
            />
            {r.value === "" ? "Unknown" : (tab.text?.(r.value) ?? r.value)}
            <span className="tnum text-fg">
              {formatPercent(r.visitors / sum)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function BarList({
  rows,
  tab,
  loading,
  onSelect,
  selected,
  total,
  shareLabel = "Share",
  showCount,
}: {
  rows?: BreakdownRow[]
  tab: Pick<BreakdownTab, "countLabel" | "render" | "empty">
  loading?: boolean
  onSelect?: (value: string) => void
  selected?: string
  /** Visitors in the whole period; adds a column with each row's share of them. */
  total?: number
  shareLabel?: string
  /** Always show the count column (it is hidden on phones otherwise). */
  showCount?: boolean
}) {
  if (loading || !rows) {
    return (
      <div className="flex flex-col gap-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton
            key={i}
            className="h-8"
            style={{ width: `${100 - i * 12}%` }}
          />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
        <p className="display text-xl text-fg-secondary">Nothing yet</p>
        <p className="text-xs text-fg-muted">No data for this period.</p>
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.visitors), 1)
  const showShare = total !== undefined && total > 0
  return (
    <div className="flex flex-col text-[13px]">
      <div className="eyebrow flex justify-between pb-2 pl-9 text-[10px] tracking-[0.14em]">
        <span />
        <span className="flex gap-3">
          <span className="w-14 text-right">Visitors</span>
          <span
            className={cn("w-14 text-right", !showCount && "max-sm:hidden")}
          >
            {tab.countLabel}
          </span>
          {showShare && <span className="w-11 text-right">{shareLabel}</span>}
        </span>
      </div>
      {rows.map((r, i) => {
        const label =
          r.value === ""
            ? (tab.empty ?? "(none)")
            : (tab.render?.(r.value) ?? r.value)
        const Row = onSelect ? "button" : "div"
        const isSelected = selected === r.value
        return (
          <Row
            key={r.value}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(r.value) : undefined}
            aria-pressed={onSelect ? isSelected : undefined}
            className={cn(
              "group flex h-8 items-center gap-2 rounded-sm text-left transition-colors hover:bg-accent",
              isSelected && "bg-accent"
            )}
          >
            <span className="tnum w-7 shrink-0 pl-1 text-[11px] text-fg-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="relative flex h-full min-w-0 flex-1 items-center">
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-1 left-0 rounded-r-sm border-l-2 border-accent-deep bg-violet/15 transition-colors group-hover:bg-violet/25",
                  isSelected && "bg-violet/30"
                )}
                style={{ width: `${Math.max((r.visitors / max) * 100, 1)}%` }}
              />
              <span
                className="relative flex min-w-0 items-center gap-2 truncate px-2"
                title={r.value}
              >
                {label}
              </span>
            </span>
            <span className="tnum flex shrink-0 gap-3 pr-1">
              <span className="w-14 text-right text-fg">
                {formatNumber(r.visitors)}
              </span>
              <span
                className={cn(
                  "w-14 text-right text-fg-muted",
                  !showCount && "max-sm:hidden"
                )}
              >
                {formatNumber(r.count)}
              </span>
              {showShare && (
                <span className="w-11 text-right text-fg-muted">
                  {formatPercent(Math.min(r.visitors / total, 1))}
                </span>
              )}
            </span>
          </Row>
        )
      })}
    </div>
  )
}
