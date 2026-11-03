import { change, formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Change against the previous period. The brand has no green or red, so the
 * direction is carried by the glyph, and "good" by accent-deep vs. a quieter grey.
 */
export function Delta({
  current,
  previous,
  lowerIsBetter,
  className,
}: {
  current: number
  previous: number
  lowerIsBetter?: boolean
  className?: string
}) {
  const d = change(current, previous)
  if (d === null)
    return <span className={cn("text-xs text-fg-muted", className)}>new</span>
  const flat = Math.abs(d) < 0.005
  const up = d > 0
  const good = lowerIsBetter ? !up : up
  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-1 text-xs whitespace-nowrap",
        flat
          ? "text-fg-muted"
          : good
            ? "text-accent-deep"
            : "text-fg-secondary",
        className
      )}
      title={flat ? "No change" : `${good ? "Better" : "Worse"} than before`}
    >
      <span aria-hidden className="text-[9px]">
        {flat ? "■" : up ? "▲" : "▼"}
      </span>
      {flat ? "0%" : formatSignedPercent(d)}
    </span>
  )
}
