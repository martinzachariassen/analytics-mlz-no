import { useId } from "react"

import { cn } from "@/lib/utils"

/** A tiny trend line; no axes, the number beside it carries the meaning. */
export function Sparkline({
  values,
  className,
  color = "var(--accent)",
}: {
  values: number[]
  className?: string
  color?: string
}) {
  const id = useId()
  const w = 120
  const h = 32
  if (values.length < 2) return <div className={cn("h-8", className)} />
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pts = values.map(
    (v, i) =>
      [
        (i / (values.length - 1)) * w,
        h - 2 - ((v - min) / span) * (h - 4),
      ] as const
  )
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-8 w-full overflow-visible", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${h} ${line} ${w},${h}`}
        fill={`url(#${CSS.escape(id)})`}
      />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
