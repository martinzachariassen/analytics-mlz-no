import { useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
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
import { formatNumber } from "@/lib/format"

export type BreakdownTab = {
  dim: Dimension
  label: string
  /** Column header for the count, e.g. "Views" or "Visits". */
  countLabel: string
  /** Renders a value; empty values usually mean "none". */
  render?: (value: string) => ReactNode
  empty?: string
}

const PAGE = 10
const MORE = 100

/** A card with tabs, each showing the top values of a dimension as proportional bars. */
export function BreakdownCard({
  title,
  siteId,
  range,
  tabs,
}: {
  title: string
  siteId: string
  range: RangeParams
  tabs: BreakdownTab[]
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {/* Wide cards: tabs beside the title. */}
        {tabSwitcher && (
          <CardAction className="max-sm:hidden">{tabSwitcher}</CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {/* Phones: tabs on their own row so labels don't get clipped. */}
        {tabSwitcher && (
          <div className="overflow-x-auto sm:hidden">{tabSwitcher}</div>
        )}
        <BarList rows={rows.data} tab={tab} loading={rows.isPending} />
        {rows.data && rows.data.length === limit && !expanded && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
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
}: {
  rows?: BreakdownRow[]
  tab: Pick<BreakdownTab, "countLabel" | "render" | "empty">
  loading?: boolean
  onSelect?: (value: string) => void
  selected?: string
}) {
  if (loading || !rows) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No data for this period
      </p>
    )
  }

  const max = Math.max(...rows.map((r) => r.visitors), 1)
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between px-2 text-xs text-muted-foreground">
        <span />
        <span className="flex gap-4">
          <span className="w-14 text-right">Visitors</span>
          <span className="w-14 text-right">{tab.countLabel}</span>
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
            onClick={onSelect ? () => onSelect(r.value) : undefined}
            className="relative flex h-8 items-center justify-between rounded-md px-2 text-left enabled:hover:bg-muted data-[selected=true]:ring-1 data-[selected=true]:ring-ring"
            data-selected={selected === r.value}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-md bg-chart-1/12"
              style={{ width: `${(r.visitors / max) * 100}%` }}
            />
            <span className="relative truncate pr-4" title={r.value}>
              {label}
            </span>
            <span className="relative flex shrink-0 gap-4 tabular-nums">
              <span className="w-14 text-right font-medium">
                {formatNumber(r.visitors)}
              </span>
              <span className="w-14 text-right text-muted-foreground">
                {formatNumber(r.count)}
              </span>
            </span>
          </Row>
        )
      })}
    </div>
  )
}
