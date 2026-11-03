import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { change, formatSignedPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Change against the comparison period, as a small badge. The arrow carries
 * the direction, colour only whether it is good, so it never relies on colour
 * alone. `lowerIsBetter` flips good and bad (bounce rate).
 */
export function Delta({
  current,
  previous,
  lowerIsBetter,
  className,
  plain,
}: {
  current: number
  previous: number
  lowerIsBetter?: boolean
  className?: string
  /** Text only, no badge background (for tables). */
  plain?: boolean
}) {
  const d = change(current, previous)
  if (d === null)
    return (
      <span className={cn("text-[11px] font-medium text-fg-muted", className)}>
        new
      </span>
    )
  const flat = Math.abs(d) < 0.005
  const up = d > 0
  const good = lowerIsBetter ? !up : up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-0.5 rounded-[5px] text-[11px] font-medium whitespace-nowrap",
        !plain && "px-1.5 py-0.5",
        flat
          ? "bg-muted text-fg-muted"
          : good
            ? "bg-positive/12 text-positive"
            : "bg-negative/12 text-negative",
        plain && "bg-transparent!",
        className
      )}
      title={flat ? "No change" : `${good ? "Better" : "Worse"} than before`}
    >
      {!flat && <Icon aria-hidden className="size-3" strokeWidth={2.5} />}
      {flat ? "0%" : formatSignedPercent(d)}
    </span>
  )
}
