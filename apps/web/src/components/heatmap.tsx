import { useQuery } from "@tanstack/react-query"
import { type KeyboardEvent, useRef, useState } from "react"

import { ErrorNote } from "@/components/error-note"
import { Panel, TextTabs } from "@/components/panel"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { useParamChoice, useScope } from "@/lib/use-scope"

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const METRICS = ["visitors", "pageviews"] as const

const hourRange = (h: number) =>
  `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`

/** The busiest cell, for the text summary. */
export function busiest(grid: number[][]): { d: number; h: number; v: number } {
  let best = { d: 0, h: 0, v: -1 }
  grid.forEach((row, d) => {
    row.forEach((v, h) => {
      if (v > best.v) best = { d, h, v }
    })
  })
  return best
}

/** One hue, light to dark: the share of the busiest cell. */
export function ramp(t: number): string {
  if (t <= 0) return "var(--surface-2)"
  const pct = Math.round(12 + Math.min(t, 1) * 88)
  return `color-mix(in oklch, var(--accent) ${pct}%, var(--surface-2))`
}

/** Traffic by weekday and hour, in the browser's time zone. */
export function ActiveHours({ className }: { className?: string }) {
  const sc = useScope()
  const [metric, setMetric] = useParamChoice("hours", METRICS)
  const q = useQuery({
    queryKey: ["heatmap", sc.siteId, { ...sc.scope, compare: undefined }],
    queryFn: () => api.heatmap(sc.siteId, sc.scope),
  })
  const grid = q.data?.[metric]
  const max = grid ? Math.max(1, ...grid.flat()) : 1
  const label = metric === "visitors" ? "visitors" : "page views"
  const top = grid ? busiest(grid) : undefined

  return (
    <Panel
      title="Active hours"
      description="Local time"
      className={className}
      tabs={
        <TextTabs
          label="Metric"
          value={metric}
          onChange={setMetric}
          items={[
            { value: "visitors", label: "Visitors" },
            { value: "pageviews", label: "Page views" },
          ]}
        />
      }
    >
      {q.isError ? (
        <ErrorNote queries={[q]} className="h-52 py-0" />
      ) : !grid ? (
        <Skeleton className="h-52" />
      ) : (
        <div className="flex flex-col gap-3">
          {top && (
            <p className="sr-only">
              {top.v > 0
                ? `Busiest hour: ${DAYS[top.d]} ${hourRange(top.h)} with ${formatNumber(top.v)} ${label}.`
                : `No ${label} in this period.`}
            </p>
          )}
          <Grid grid={grid} max={max} label={label} />
          <div className="flex items-center justify-end gap-2 text-[11px] text-fg-muted">
            Less
            <span className="flex gap-[3px]">
              {[0.05, 0.25, 0.5, 0.75, 1].map((t) => (
                <span
                  key={t}
                  className="size-3 rounded-[3px]"
                  style={{ background: ramp(t) }}
                />
              ))}
            </span>
            More
          </div>
        </div>
      )}
    </Panel>
  )
}

/** One tab stop for all 168 cells: arrow keys move between them and show their tooltip. */
function Grid({
  grid,
  max,
  label,
}: {
  grid: number[][]
  max: number
  label: string
}) {
  const [at, setAt] = useState({ d: 0, h: 0 })
  const ref = useRef<HTMLFieldSetElement>(null)

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Home: [0, -at.h],
      End: [0, 23 - at.h],
    }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    const next = {
      d: Math.min(Math.max(at.d + m[0], 0), grid.length - 1),
      h: Math.min(Math.max(at.h + m[1], 0), 23),
    }
    setAt(next)
    ref.current
      ?.querySelector<HTMLElement>(`[data-cell="${next.d}-${next.h}"]`)
      ?.focus()
  }

  return (
    <fieldset
      ref={ref}
      onKeyDown={onKeyDown}
      className="m-0 grid min-w-0 gap-[3px] border-0 p-0"
      style={{
        gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))",
      }}
    >
      <legend className="sr-only">
        {label[0]!.toUpperCase() + label.slice(1)} by weekday and hour. Use the
        arrow keys to move.
      </legend>
      {grid.map((row, d) => (
        <div key={d} className="contents">
          <span
            aria-hidden
            className="flex items-center text-[11px] text-fg-muted"
          >
            {DAYS[d]}
          </span>
          {row.map((v, h) => {
            const text = `${DAYS[d]} ${hourRange(h)} · ${formatNumber(v)} ${label}`
            return (
              <Tooltip key={h} delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={text}
                    data-cell={`${d}-${h}`}
                    tabIndex={at.d === d && at.h === h ? 0 : -1}
                    onFocus={() => setAt({ d, h })}
                    className="aspect-square min-h-3 rounded-[3px] transition-[outline] outline-none hover:outline hover:outline-1 hover:outline-fg/50 focus-visible:outline-2 focus-visible:outline-accent"
                    style={{ background: ramp(v / max) }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="tnum">{text}</span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      ))}
      <span aria-hidden />
      {HOURS.map((h) => (
        <span
          key={h}
          aria-hidden
          className="tnum pt-1 text-center text-[10px] text-fg-muted"
        >
          {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
        </span>
      ))}
    </fieldset>
  )
}
