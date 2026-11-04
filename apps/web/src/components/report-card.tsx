import { useState, type ReactNode } from "react"

import { BarList, ViewAll } from "@/components/bar-list"
import { ErrorNote } from "@/components/error-note"
import { Panel, TextTabs } from "@/components/panel"
import type { Dimension } from "@/lib/api"
import { DIMS, DIM_VIEW, isFilterDim } from "@/lib/dims"
import { useBreakdown } from "@/lib/queries"
import { useScope } from "@/lib/use-scope"

export type ReportTab = { dim: Dimension; label?: string }

/**
 * A compact top list on the overview: tabs over related dimensions, the top
 * values as a bar list, and a link to the full report view.
 */
export function ReportCard({
  title,
  tabs,
  total,
  rows = 8,
  className,
  action,
  children,
}: {
  title: string
  tabs: ReportTab[]
  /** Total visitors, for shares. */
  total?: number
  rows?: number
  className?: string
  action?: ReactNode
  /** Rendered above the list for the active tab (e.g. a proportion strip). */
  children?: (dim: Dimension) => ReactNode
}) {
  const sc = useScope()
  const [dim, setDim] = useState<Dimension>(tabs[0]!.dim)
  const q = useBreakdown(sc.siteId, sc.scope, dim, { limit: rows })
  const view = DIM_VIEW[dim]

  return (
    <Panel
      title={title}
      className={className}
      action={action}
      tabs={
        tabs.length > 1 ? (
          <TextTabs
            label={title}
            value={dim}
            onChange={setDim}
            items={tabs.map((t) => ({
              value: t.dim,
              label: t.label ?? DIMS[t.dim].plural,
            }))}
          />
        ) : undefined
      }
    >
      {children?.(dim)}
      {q.isError && <ErrorNote error={q.error} className="py-2" />}
      <BarList
        dim={dim}
        rows={q.data}
        loading={q.isPending && !q.isError}
        total={total}
        rowsShown={rows}
        onOpen={
          isFilterDim(dim)
            ? (r) => sc.openDetail({ dim, value: r.value })
            : undefined
        }
        onFilter={
          isFilterDim(dim)
            ? (r) => sc.addFilter({ dim, op: "is", value: r.value })
            : undefined
        }
      />
      {view && (
        <ViewAll to={`/sites/${sc.siteId}/${view}${withTab(sc.search, dim)}`} />
      )}
    </Panel>
  )
}

/** Adds ?tab=dim to a query string. */
export function withTab(search: string, dim: string): string {
  const q = new URLSearchParams(search)
  q.set("tab", dim)
  return `?${q.toString()}`
}
