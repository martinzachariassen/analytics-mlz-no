import type { BreakdownRow, Dimension } from "@/lib/api"
import { formatValue } from "@/lib/dims"
import { formatPercent } from "@/lib/format"

/**
 * Shares as one segmented bar, with a legend. The top values take the first
 * categorical colours, the rest is folded into "Other".
 */
export function ProportionStrip({
  dim,
  rows,
  max = 4,
}: {
  dim: Dimension
  rows?: BreakdownRow[]
  max?: number
}) {
  if (!rows || rows.length === 0) return null
  const total = rows.reduce((n, r) => n + r.visitors, 0) || 1
  const top = rows.slice(0, max)
  const other = total - top.reduce((n, r) => n + r.visitors, 0)
  const parts = [
    ...top.map((r, i) => ({
      key: r.value,
      label: formatValue(dim, r.value),
      share: r.visitors / total,
      color: `var(--series-${i + 1})`,
    })),
    ...(other > 0
      ? [
          {
            key: "_other",
            label: "Other",
            share: other / total,
            color: "var(--fg-muted)",
          },
        ]
      : []),
  ]
  return (
    <div className="mb-4 flex flex-col gap-2.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {parts.map((p) => (
          <span
            key={p.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${p.share * 100}%`, background: p.color }}
            title={`${p.label}: ${formatPercent(p.share)}`}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[2px]"
              style={{ background: p.color }}
            />
            <span className="text-fg-secondary">{p.label}</span>
            <span className="tnum font-medium text-fg">
              {formatPercent(p.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
