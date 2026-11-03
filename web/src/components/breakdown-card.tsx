import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Inbox } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  api,
  type BreakdownRow,
  type Dimension,
  type RangeParams,
} from "@/lib/api"
import { formatNumber, formatPercent } from "@/lib/format"

export type BreakdownTab = {
  dim: Dimension
  label: string
  /** Column header for the count, e.g. "Views" or "Visits". */
  countLabel: string
  /** Renders a value; empty values usually mean "none". */
  render?: (value: string) => ReactNode
  empty?: ReactNode
}

export const PAGE = 10
const MORE = 100

/** A card with tabs, each showing the top values of a dimension as proportional bars. */
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
  const [expanded, setExpanded] = useState(false)
  const tab = tabs.find((t) => t.dim === active) ?? tabs[0]!
  const limit = expanded ? MORE : PAGE

  const rows = useQuery({
    queryKey: ["breakdown", siteId, range, tab.dim, limit],
    queryFn: () => api.breakdown(siteId, range, tab.dim, { limit }),
  })

  const tabSwitcher =
    tabs.length > 1 ? (
      <Tabs
        value={active}
        onValueChange={(v) => {
          setActive(v as Dimension)
          setExpanded(false)
        }}
      >
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.dim} value={t.dim} className="text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    ) : null

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {/* Wide cards: tabs beside the title. */}
        {tabSwitcher && (
          <CardAction className="max-sm:hidden">{tabSwitcher}</CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        {/* Phones: tabs on their own row so labels don't get clipped. */}
        {tabSwitcher && (
          <div className="overflow-x-auto sm:hidden">{tabSwitcher}</div>
        )}
        <BarList
          rows={rows.data}
          tab={tab}
          loading={rows.isPending}
          total={totalVisitors}
        />
        {rows.data && rows.data.length === limit && !expanded && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-auto self-center text-muted-foreground"
            onClick={() => setExpanded(true)}
          >
            Show more
          </Button>
        )}
      </CardContent>
    </Card>
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
}: {
  rows?: BreakdownRow[]
  tab: Pick<BreakdownTab, "countLabel" | "render" | "empty">
  loading?: boolean
  onSelect?: (value: string) => void
  selected?: string
  /** Visitors in the whole period; adds a column with each row's share of them. */
  total?: number
  shareLabel?: string
}) {
  if (loading || !rows) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Inbox className="size-6 opacity-60" />
        No data for this period
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.visitors), 1)
  const showShare = total !== undefined && total > 0
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between px-2 pb-1 text-xs text-muted-foreground">
        <span />
        <span className="flex gap-3">
          <span className="w-14 text-right">Visitors</span>
          <span className="w-14 text-right max-sm:hidden">
            {tab.countLabel}
          </span>
          {showShare && <span className="w-12 text-right">{shareLabel}</span>}
        </span>
      </div>
      {rows.map((r) => {
        const label =
          r.value === ""
            ? (tab.empty ?? "(none)")
            : (tab.render?.(r.value) ?? r.value)
        const Row = onSelect ? "button" : "div"
        return (
          <Row
            key={r.value}
            type={onSelect ? "button" : undefined}
            onClick={onSelect ? () => onSelect(r.value) : undefined}
            className="group relative flex h-9 items-center justify-between rounded-md px-2 text-left transition-colors hover:bg-muted/60 data-[selected=true]:bg-muted data-[selected=true]:ring-1 data-[selected=true]:ring-chart-1/50"
            data-selected={selected === r.value}
          >
            <span
              className="absolute inset-y-0.5 left-0 rounded-md bg-chart-1/14 transition-colors group-hover:bg-chart-1/20"
              style={{ width: `${Math.max((r.visitors / max) * 100, 1)}%` }}
            />
            <span
              className="relative flex min-w-0 items-center gap-2 truncate pr-4"
              title={r.value}
            >
              {label}
            </span>
            <span className="relative flex shrink-0 gap-3 tabular-nums">
              <span className="w-14 text-right font-medium">
                {formatNumber(r.visitors)}
              </span>
              <span className="w-14 text-right text-muted-foreground max-sm:hidden">
                {formatNumber(r.count)}
              </span>
              {showShare && (
                <span className="w-12 text-right text-muted-foreground">
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
